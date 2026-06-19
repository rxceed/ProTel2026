import jwt, { type SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db/client';
import { users as usersTable } from '@/db/schema/mst';
import { refreshTokens as refreshTokensTable } from '@/db/schema';
import { authLogs as authLogsTable } from '@/db/schema';
import { config } from '@/config';
import { generateToken, sha256 } from '@/shared/utils/crypto.util';
import { parseExpiryMs, parseExpirySec } from '@/shared/utils/time.util';
import { AppError } from '@/middleware/error.middleware';
import { logger } from '@/shared/utils/logger.util';
import type { JwtPayload, SystemRole } from '@/shared/types';
import type { LoginInput, TokenResponse } from './auth.schema';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function issueTokens(userId: string, role: SystemRole): Promise<TokenResponse> {
  // 1. Sign JWT access token (15m default)
  const payload: JwtPayload = { sub: userId, role };
  const access_token = jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'],
  });

  // 2. Generate opaque refresh token (48 random bytes → base64url)
  const rawRefresh   = generateToken(48);
  const tokenHash    = sha256(rawRefresh);
  const expiresAt    = new Date(Date.now() + parseExpiryMs(config.JWT_REFRESH_EXPIRES_IN));

  // 3. Store SHA-256 hash in DB (never store raw token)
  await db.insert(refreshTokensTable).values({
    userId,
    tokenHash,
    expiresAt,
    revoked: false,
  });

  return {
    access_token,
    refresh_token: rawRefresh,
    token_type:   'Bearer',
    expires_in:   parseExpirySec(config.JWT_ACCESS_EXPIRES_IN),
  };
}

/** Log auth events — jangan crash kalau logging gagal */
async function logAuth(event: {
  userId?:    string;
  eventType:  string;
  success:    boolean;
  ipAddress?: string;
  userAgent?: string;
  notes?:     string;
}): Promise<void> {
  try {
    await db.insert(authLogsTable).values({
      userId:    event.userId,
      eventType: event.eventType,
      success:   event.success,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      notes:     event.notes,
    });
  } catch (err) {
    logger.warn({ err }, 'Failed to write auth log');
  }
}

// ---------------------------------------------------------------------------
// Auth service
// ---------------------------------------------------------------------------

export const authService = {
  // ── POST /auth/login ──────────────────────────────────────────────────────
  async login(
    input: LoginInput,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<TokenResponse> {
    const email = input.email.toLowerCase().trim();

    // 1. Find user (hati2: jangan bedain "email tidak ada" vs "password salah")
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (!user || !user.isActive) {
      await logAuth({
        eventType: 'LOGIN_FAILED',
        success:   false,
        ipAddress: meta?.ip,
        notes:     user ? 'User inactive' : 'Email not found',
      });
      // Pesan sama untuk cegah user enumeration
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email atau password salah');
    }

    // 2. Constant-time password comparison
    const isValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!isValid) {
      await logAuth({
        userId:    user.id,
        eventType: 'LOGIN_FAILED',
        success:   false,
        ipAddress: meta?.ip,
        notes:     'Wrong password',
      });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email atau password salah');
    }

    // 3. Update last_login_at
    await db
      .update(usersTable)
      .set({ lastLoginAt: new Date() })
      .where(eq(usersTable.id, user.id));

    // 4. Issue tokens
    const tokens = await issueTokens(user.id, user.systemRole as SystemRole);

    await logAuth({
      userId:    user.id,
      eventType: 'LOGIN_SUCCESS',
      success:   true,
      ipAddress: meta?.ip,
      userAgent: meta?.userAgent,
    });

    return tokens;
  },

  // ── POST /auth/refresh ────────────────────────────────────────────────────
  async refresh(
    rawToken: string,
  ): Promise<Pick<TokenResponse, 'access_token' | 'token_type' | 'expires_in'>> {
    const tokenHash = sha256(rawToken);
    const now       = new Date();

    // 1. Lookup token by hash
    const [tokenRow] = await db
      .select()
      .from(refreshTokensTable)
      .where(
        and(
          eq(refreshTokensTable.tokenHash, tokenHash),
          eq(refreshTokensTable.revoked, false),
        ),
      )
      .limit(1);

    if (!tokenRow) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token tidak valid atau sudah digunakan');
    }

    if (tokenRow.expiresAt < now) {
      throw new AppError(401, 'REFRESH_TOKEN_EXPIRED', 'Sesi habis, silakan login ulang');
    }

    // 2. Get user
    const [user] = await db
      .select({
        id:         usersTable.id,
        systemRole: usersTable.systemRole,
        isActive:   usersTable.isActive,
      })
      .from(usersTable)
      .where(eq(usersTable.id, tokenRow.userId))
      .limit(1);

    if (!user || !user.isActive) {
      throw new AppError(401, 'USER_INACTIVE', 'Akun tidak aktif');
    }

    // 3. Re-issue access token (refresh token rotation bisa ditambahkan nanti)
    const payload: JwtPayload = { sub: user.id, role: user.systemRole as SystemRole };
    const access_token = jwt.sign(payload, config.JWT_SECRET, {
      expiresIn: config.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'],
    });

    return {
      access_token,
      token_type: 'Bearer',
      expires_in: parseExpirySec(config.JWT_ACCESS_EXPIRES_IN),
    };
  },

  // ── POST /auth/logout ─────────────────────────────────────────────────────
  async logout(rawToken: string): Promise<void> {
    const tokenHash = sha256(rawToken);

    // Revoke token — jika tidak ada / sudah revoked, tidak masalah
    await db
      .update(refreshTokensTable)
      .set({ revoked: true, revokedAt: new Date() })
      .where(eq(refreshTokensTable.tokenHash, tokenHash));
  },

  // ── GET /auth/me ──────────────────────────────────────────────────────────
  async getMe(userId: string) {
    const [user] = await db
      .select({
        id:          usersTable.id,
        email:       usersTable.email,
        fullName:    usersTable.fullName,
        systemRole:  usersTable.systemRole,
        isActive:    usersTable.isActive,
        lastLoginAt: usersTable.lastLoginAt,
        createdAt:   usersTable.createdAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User tidak ditemukan');
    }

    return user;
  },

  // ── PATCH /auth/me ────────────────────────────────────────────────────────
  async updateMe(userId: string, input: any) {
    console.log('updateMe input payload is:', input);
    const updateData: any = {};
    if (input.fullName) updateData.fullName = input.fullName;
    if (input.email) updateData.email = input.email.toLowerCase().trim();
    if (input.password) {
      updateData.passwordHash = await bcrypt.hash(input.password, 10);
    }

    if (Object.keys(updateData).length === 0) {
      return this.getMe(userId);
    }

    await db
      .update(usersTable)
      .set(updateData)
      .where(eq(usersTable.id, userId));

    return this.getMe(userId);
  },
};
