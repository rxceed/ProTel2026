import { useEffect, useState, useCallback } from 'react';
import {
  CheckCircle2, XCircle, Clock, Loader2, Droplets, ChevronDown,
  ChevronUp, AlertTriangle, Sprout, Wind, ClipboardList, History,
  RefreshCw, Filter
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/api/client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Assignment {
  id: string;
  field_id: string;
  sub_block_id: string;
  recommendation_type: 'irrigate' | 'drain' | 'observe' | 'alert_only';
  priority_rank: number;
  priority_score: string;
  command_template_code: string;
  command_text: string;
  reason_summary: string;
  confidence_level: 'high' | 'medium' | 'low';
  water_level_cm_at_decision: string | null;
  valid_until: string;
  generated_at: string;
  feedback_status: string;
  field_name: string;
  sub_block_name: string;
  sub_block_code: string;
}

interface CompletedAssignment extends Assignment {
  operator_notes: string | null;
  feedback_at: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  irrigate: { label: 'Pengairan', color: 'bg-blue-500/15 text-blue-700 border-blue-200 dark:text-blue-400', icon: <Droplets className="h-4 w-4" /> },
  drain:    { label: 'Drainase',  color: 'bg-amber-500/15 text-amber-700 border-amber-200 dark:text-amber-400', icon: <Wind className="h-4 w-4" /> },
  observe:  { label: 'Pantau',   color: 'bg-emerald-500/15 text-emerald-700 border-emerald-200 dark:text-emerald-400', icon: <Sprout className="h-4 w-4" /> },
  alert_only:{ label: 'Waspada', color: 'bg-red-500/15 text-red-700 border-red-200 dark:text-red-400', icon: <AlertTriangle className="h-4 w-4" /> },
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high:   'bg-green-100 text-green-800 border-green-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low:    'bg-red-100 text-red-800 border-red-200',
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  executed:     { label: 'Dikerjakan', color: 'bg-green-100 text-green-800 border-green-300' },
  skipped:      { label: 'Dilewati',   color: 'bg-slate-100 text-slate-600 border-slate-300' },
  deferred:     { label: 'Ditunda',    color: 'bg-amber-100 text-amber-800 border-amber-300' },
  acknowledged: { label: 'Dicatat',   color: 'bg-blue-100 text-blue-700 border-blue-300' },
};

function timeLeft(validUntil: string) {
  const diff = new Date(validUntil).getTime() - Date.now();
  if (diff <= 0) return { label: 'Kedaluwarsa', urgent: true };
  const hours = Math.floor(diff / 3_600_000);
  const mins  = Math.floor((diff % 3_600_000) / 60_000);
  return { label: `${hours}j ${mins}m tersisa`, urgent: hours < 4 };
}

// ─── Action Modal ─────────────────────────────────────────────────────────────

function ActionModal({
  task,
  onClose,
  onSubmit,
}: {
  task: Assignment;
  onClose: () => void;
  onSubmit: (action: 'executed' | 'skipped' | 'deferred', notes: string) => Promise<void>;
}) {
  const [notes, setNotes]     = useState('');
  const [submitting, setSub]  = useState(false);
  const [selected, setSelected] = useState<'executed' | 'skipped' | 'deferred' | null>(null);

  const handleSubmit = async () => {
    if (!selected) return;
    setSub(true);
    await onSubmit(selected, notes);
    setSub(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5" onClick={e => e.stopPropagation()}>
        <div className="space-y-1">
          <h3 className="text-lg font-bold">Konfirmasi Tindakan</h3>
          <p className="text-sm text-muted-foreground">{task.command_text}</p>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-3 gap-3">
          {(['executed', 'skipped', 'deferred'] as const).map(a => (
            <button
              key={a}
              onClick={() => setSelected(a)}
              className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all text-xs font-semibold
                ${selected === a
                  ? a === 'executed' ? 'border-green-500 bg-green-50 text-green-700'
                  : a === 'skipped'  ? 'border-slate-400 bg-slate-50 text-slate-700'
                  :                    'border-amber-400 bg-amber-50 text-amber-700'
                  : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40'}`}
            >
              {a === 'executed' && <CheckCircle2 className="h-6 w-6" />}
              {a === 'skipped'  && <XCircle       className="h-6 w-6" />}
              {a === 'deferred' && <Clock         className="h-6 w-6" />}
              {a === 'executed' ? 'Dikerjakan' : a === 'skipped' ? 'Dilewati' : 'Ditunda'}
            </button>
          ))}
        </div>

        {/* Notes */}
        <textarea
          rows={3}
          placeholder="Catatan lapangan (opsional)…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="w-full resize-none rounded-xl border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />

        <div className="flex gap-3 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>Batal</Button>
          <Button
            size="sm"
            disabled={!selected || submitting}
            onClick={handleSubmit}
            className="min-w-[100px]"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Konfirmasi'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onAction,
}: {
  task: Assignment;
  onAction: (t: Assignment) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta    = TYPE_META[task.recommendation_type] ?? TYPE_META['observe'];
  const tl      = timeLeft(task.valid_until);
  const pScore  = parseFloat(task.priority_score || '0');
  const confCol = CONFIDENCE_COLOR[task.confidence_level] ?? CONFIDENCE_COLOR['medium'];

  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow border-l-4"
      style={{ borderLeftColor: task.recommendation_type === 'irrigate' ? '#3b82f6'
        : task.recommendation_type === 'drain' ? '#f59e0b'
        : task.recommendation_type === 'alert_only' ? '#ef4444'
        : '#10b981' }}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header Row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`${meta.color} border flex items-center gap-1 text-xs font-semibold`}>
              {meta.icon} {meta.label}
            </Badge>
            <Badge className={`${confCol} border text-xs`}>
              Keyakinan: {task.confidence_level}
            </Badge>
            <Badge variant="outline" className={`text-xs ${tl.urgent ? 'text-destructive border-destructive' : ''}`}>
              <Clock className="h-3 w-3 mr-1" />
              {tl.label}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap font-mono">
            #{task.priority_rank} · {pScore.toFixed(0)}pt
          </span>
        </div>

        {/* Location */}
        <div className="flex items-center gap-2 text-sm">
          <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
          <span className="font-semibold">{task.sub_block_name}</span>
          <span className="text-muted-foreground">({task.sub_block_code})</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground text-xs">{task.field_name}</span>
        </div>

        {/* Command */}
        <p className="text-sm font-medium leading-snug">{task.command_text}</p>

        {/* Expandable Details */}
        <button
          onClick={() => setExpanded(p => !p)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? 'Sembunyikan Detail' : 'Lihat Alasan & Data Sensor'}
        </button>

        {expanded && (
          <div className="space-y-2 text-xs bg-muted/30 rounded-lg p-3">
            <p className="text-muted-foreground leading-relaxed">{task.reason_summary}</p>
            {task.water_level_cm_at_decision && (
              <div className="flex items-center gap-2 pt-1">
                <Droplets className="h-3.5 w-3.5 text-blue-500" />
                <span className="font-semibold">
                  Tinggi Air Saat Keputusan:
                </span>
                <span className={`font-mono font-bold ${
                  parseFloat(task.water_level_cm_at_decision) < -10 ? 'text-destructive'
                  : parseFloat(task.water_level_cm_at_decision) > 10 ? 'text-blue-600'
                  : 'text-foreground'
                }`}>
                  {parseFloat(task.water_level_cm_at_decision).toFixed(1)} cm
                </span>
              </div>
            )}
          </div>
        )}

        {/* Action */}
        <div className="flex justify-end pt-1">
          <Button size="sm" onClick={() => onAction(task)} className="gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Respons Tugas
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function TasksPage() {
  const [tab, setTab]               = useState<'pending' | 'completed'>('pending');
  const [pending, setPending]       = useState<Assignment[]>([]);
  const [completed, setCompleted]   = useState<CompletedAssignment[]>([]);
  const [loading, setLoading]       = useState(false);
  const [actionTarget, setActionTarget] = useState<Assignment | null>(null);
  const [filterType, setFilterType] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pen, com] = await Promise.all([
        apiClient.get('/assignments/pending'),
        apiClient.get('/assignments/completed'),
      ]);
      setPending(pen.data.data  ?? []);
      setCompleted(com.data.data ?? []);
    } catch (err) {
      console.error('Failed to load assignments', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (action: 'executed' | 'skipped' | 'deferred', notes: string) => {
    if (!actionTarget) return;
    try {
      await apiClient.post(`/assignments/${actionTarget.id}/action`, {
        action,
        operator_notes: notes || undefined,
      });
      setActionTarget(null);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Gagal menyimpan respons');
    }
  };

  const filteredPending = filterType === 'all'
    ? pending
    : pending.filter(p => p.recommendation_type === filterType);

  const urgentCount = pending.filter(p => {
    const diff = new Date(p.valid_until).getTime() - Date.now();
    return diff > 0 && diff < 4 * 3_600_000;
  }).length;

  return (
    <div className="flex flex-col gap-6 animate-in fade-in pb-12">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Penugasan Operasional</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Tugas lapangan yang direkomendasikan sistem. Respons setiap tugas agar sistem dapat belajar.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {urgentCount > 0 && (
            <Badge className="bg-destructive/10 text-destructive border border-destructive/30 gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {urgentCount} Mendesak
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Tugas Aktif',    value: pending.length,   color: 'text-blue-600',     bg: 'bg-blue-50 dark:bg-blue-900/20',  icon: <ClipboardList className="h-5 w-5" /> },
          { label: 'Mendesak (<4j)', value: urgentCount,      color: 'text-destructive',  bg: 'bg-red-50 dark:bg-red-900/20',    icon: <AlertTriangle  className="h-5 w-5" /> },
          { label: 'Dikerjakan',     value: completed.filter(c => c.feedback_status === 'executed').length, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', icon: <CheckCircle2 className="h-5 w-5" /> },
          { label: 'Riwayat Total',  value: completed.length, color: 'text-slate-600',    bg: 'bg-slate-50 dark:bg-slate-900/20',icon: <History        className="h-5 w-5" /> },
        ].map(s => (
          <Card key={s.label} className="shadow-sm">
            <CardContent className={`p-4 flex items-center gap-3 ${s.bg} rounded-lg`}>
              <div className={s.color}>{s.icon}</div>
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tab Bar */}
      <div className="flex border-b gap-6 text-sm">
        {[
          { id: 'pending'   as const, label: `Tugas Aktif (${pending.length})`,    icon: <ClipboardList className="h-4 w-4" /> },
          { id: 'completed' as const, label: `Riwayat (${completed.length})`, icon: <History        className="h-4 w-4" /> },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 pb-3 font-semibold border-b-2 transition-colors ${
              tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-16">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-sm">Memuat tugas lapangan...</span>
          </div>
        </div>
      )}

      {/* Tab: Pending */}
      {!loading && tab === 'pending' && (
        <div className="space-y-4">
          {/* Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {['all', 'irrigate', 'drain', 'observe', 'alert_only'].map(f => (
              <button
                key={f}
                onClick={() => setFilterType(f)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  filterType === f ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/30 border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {f === 'all' ? 'Semua' : TYPE_META[f]?.label ?? f}
              </button>
            ))}
          </div>

          {filteredPending.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground space-y-2">
              <CheckCircle2 className="h-12 w-12 mx-auto opacity-30" />
              <p className="font-semibold">Tidak ada tugas aktif</p>
              <p className="text-xs">Semua tugas sudah direspons atau belum ada siklus DSS baru.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredPending.map(t => (
                <TaskCard key={t.id} task={t} onAction={setActionTarget} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Completed */}
      {!loading && tab === 'completed' && (
        <div className="space-y-3">
          {completed.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground space-y-2">
              <History className="h-12 w-12 mx-auto opacity-30" />
              <p className="font-semibold">Belum ada riwayat tindakan</p>
            </div>
          ) : (
            <div className="border rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold">Jenis</th>
                      <th className="text-left px-4 py-3 font-semibold">Lokasi</th>
                      <th className="text-left px-4 py-3 font-semibold">Perintah</th>
                      <th className="text-left px-4 py-3 font-semibold">Status</th>
                      <th className="text-left px-4 py-3 font-semibold">Catatan</th>
                      <th className="text-left px-4 py-3 font-semibold">Waktu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {completed.map((c, i) => {
                      const meta   = TYPE_META[c.recommendation_type] ?? TYPE_META['observe'];
                      const smeta  = STATUS_META[c.feedback_status] ?? { label: c.feedback_status, color: '' };
                      return (
                        <tr key={c.id} className={`hover:bg-muted/30 transition-colors ${i % 2 === 0 ? '' : 'bg-muted/10'}`}>
                          <td className="px-4 py-3">
                            <Badge className={`${meta.color} border flex items-center gap-1 text-xs w-fit`}>
                              {meta.icon} {meta.label}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium">{c.sub_block_name}</p>
                            <p className="text-xs text-muted-foreground">{c.field_name}</p>
                          </td>
                          <td className="px-4 py-3 max-w-[220px]">
                            <p className="text-xs leading-snug line-clamp-2">{c.command_text}</p>
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={`${smeta.color} border text-xs`}>{smeta.label}</Badge>
                          </td>
                          <td className="px-4 py-3 max-w-[160px]">
                            <p className="text-xs text-muted-foreground italic line-clamp-2">
                              {c.operator_notes || '—'}
                            </p>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <p className="text-xs text-muted-foreground">
                              {c.feedback_at
                                ? new Date(c.feedback_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                                : '—'
                              }
                            </p>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action Modal */}
      {actionTarget && (
        <ActionModal
          task={actionTarget}
          onClose={() => setActionTarget(null)}
          onSubmit={handleAction}
        />
      )}
    </div>
  );
}
