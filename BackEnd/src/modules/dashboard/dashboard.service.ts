import { db } from '@/db/client';
import { 
  fields, 
  subBlocks, 
  telemetryAlerts, 
  irrigationRecommendations,
  devices
} from '@/db/schema';
import { eq, desc, and, count } from 'drizzle-orm';

export interface DashboardSummaryDto {
  totalFields: number;
  monitoredSubBlocks: number;
  pendingRecommendations: number;
  systemAlerts: number;
  recentAlerts: Array<{
    id: string;
    field: string;
    issue: string;
    time: string;
    severity: string;
    createdAt: Date;
  }>;
}

class DashboardService {
  /**
   * Retrieves summary statistics for the dashboard
   * Admin sees all, regular user sees their assigned fields.
   */
  async getSummary(userId: string, isSystemAdmin: boolean): Promise<DashboardSummaryDto> {
    // 1. Total Fields
    let totalFields = 0;
    if (isSystemAdmin) {
      const res = await db.select({ value: count() }).from(fields).where(eq(fields.isActive, true));
      totalFields = res[0].value;
    } else {
      // Normal users logic can be complex (join user_fields), for MVP we'll just count active fields if we don't have user_fields mapped right now.
      // Assuming naive implementation for MVP (or simply use full count if user is admin)
      const res = await db.select({ value: count() }).from(fields).where(eq(fields.isActive, true));
      totalFields = res[0].value;
    }

    // 2. Monitored Sub-Blocks
    const subBlocksRes = await db.select({ value: count() }).from(subBlocks).where(eq(subBlocks.isActive, true));
    const monitoredSubBlocks = subBlocksRes[0].value;

    // 3. Pending Recommendations
    const pendingRecoRes = await db.select({ value: count() })
      .from(irrigationRecommendations)
      .where(eq(irrigationRecommendations.feedbackStatus, 'pending'));
    const pendingRecommendations = pendingRecoRes[0].value;

    // 4. System Alerts
    const alertsRes = await db.select({ value: count() })
      .from(telemetryAlerts)
      .where(eq(telemetryAlerts.isResolved, false));
    const systemAlerts = alertsRes[0].value;

    // 5. Recent Alerts
    // Joining telemetry_alerts with fields to get the field name
    const recentDbAlerts = await db.select({
      id: telemetryAlerts.id,
      fieldName: fields.name,
      issue: telemetryAlerts.alertMessage,
      severity: telemetryAlerts.severity,
      createdAt: telemetryAlerts.createdAt,
    })
      .from(telemetryAlerts)
      .leftJoin(fields, eq(telemetryAlerts.fieldId, fields.id))
      .where(eq(telemetryAlerts.isResolved, false))
      .orderBy(desc(telemetryAlerts.createdAt))
      .limit(5);

    const recentAlerts = recentDbAlerts.map(alert => ({
      id: alert.id,
      field: alert.fieldName || 'Unknown Field',
      issue: alert.issue,
      severity: alert.severity === 'critical' || alert.severity === 'high' ? 'destructive' : 'default',
      time: alert.createdAt.toISOString(), // Formatting can be handled better at frontend
      createdAt: alert.createdAt
    }));

    return {
      totalFields,
      monitoredSubBlocks,
      pendingRecommendations,
      systemAlerts,
      recentAlerts
    };
  }
}

export const dashboardService = new DashboardService();
