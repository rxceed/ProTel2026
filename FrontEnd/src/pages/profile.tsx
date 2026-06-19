import { useState, useEffect } from 'react';
import { User, Mail, Shield, Check, AlertCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';

interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  systemRole: string;
}

export function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/auth/me');
      const data = res.data.data;
      setProfile(data);
      setFullName(data.fullName || '');
      setEmail(data.email || '');
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err.response?.data?.message || 'Gagal memuat profil',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (password && password !== confirmPassword) {
      setMessage({ type: 'error', text: 'Konfirmasi password tidak cocok' });
      return;
    }

    try {
      setSaving(true);
      const payload: any = { fullName, email };
      if (password) payload.password = password;

      const res = await apiClient.patch('/auth/me', payload);
      setProfile(res.data.data);
      setMessage({ type: 'success', text: 'Profil berhasil diperbarui!' });
      
      // Update data user di localStorage agar sinkron dengan Header
      const cachedUserStr = localStorage.getItem('user');
      if (cachedUserStr) {
        const cachedUser = JSON.parse(cachedUserStr);
        cachedUser.email = email;
        cachedUser.full_name = fullName;
        localStorage.setItem('user', JSON.stringify(cachedUser));
      }
      
      setPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      let errorMsg = err.response?.data?.error?.message || err.response?.data?.message || 'Gagal memperbarui profil';
      const details = err.response?.data?.error?.details;
      if (details && typeof details === 'object') {
        const specificErrors = Object.values(details).flat().join(', ');
        if (specificErrors) errorMsg += `: ${specificErrors}`;
      }

      setMessage({
        type: 'error',
        text: errorMsg,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p>Memuat profil pengguna...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6 animate-in fade-in">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Akun Profil</h2>
        <p className="text-muted-foreground mt-1">
          Kelola data diri individu dan amankan akun operasional Anda.
        </p>
      </div>

      {message && (
        <div className={`p-4 rounded-md flex items-center gap-3 text-sm ${
          message.type === 'success' 
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400' 
            : 'bg-destructive/10 border border-destructive/20 text-destructive'
        }`}>
          {message.type === 'success' ? <Check className="h-5 w-5 shrink-0" /> : <AlertCircle className="h-5 w-5 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Informasi Personal</CardTitle>
            <CardDescription>Ubah nama publik dan alamat email Anda.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nama Lengkap</label>
              <div className="flex bg-background border px-3 py-2 rounded-md items-center text-sm shadow-sm focus-within:ring-1 focus-within:ring-ring">
                <User className="h-4 w-4 text-muted-foreground mr-2 shrink-0" />
                <input 
                  required
                  className="bg-transparent border-none outline-none w-full text-foreground"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Email Address</label>
              <div className="flex bg-background border px-3 py-2 rounded-md items-center text-sm shadow-sm focus-within:ring-1 focus-within:ring-ring">
                <Mail className="h-4 w-4 text-muted-foreground mr-2 shrink-0" />
                <input 
                  required
                  type="email"
                  className="bg-transparent border-none outline-none w-full text-foreground"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">System Role (Jabatan)</label>
              <div className="flex bg-muted border px-3 py-2 rounded-md items-center text-sm text-muted-foreground cursor-not-allowed">
                <Shield className="h-4 w-4 mr-2 shrink-0" />
                <span className="capitalize font-medium">{profile?.systemRole.replace('_', ' ')}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Hak akses tingkat sistem ini hanya dapat dimodifikasi oleh admin utama.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Keamanan (Ganti Password)</CardTitle>
            <CardDescription>Kosongkan field ini jika tidak bermaksud merubah password.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Password Baru</label>
              <input 
                type="password"
                placeholder="••••••"
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Konfirmasi Password</label>
              <input 
                type="password"
                placeholder="••••••"
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Simpan Perubahan
          </Button>
        </div>
      </form>
    </div>
  );
}
