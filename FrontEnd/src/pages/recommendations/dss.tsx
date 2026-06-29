import { useEffect, useState } from 'react';
import { 
  CheckCircle, 
  XSquare, 
  Clock, 
  Loader2, 
  Droplets,
  Sprout,
  ShieldAlert,
  Bell,
  Syringe,
  AlertTriangle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/api/client';
import { useDialog } from '@/components/ui/dialog-provider';

interface Field {
  id: string;
  name: string;
}

interface SubBlock {
  id: string;
  name: string;
  code: string;
}

interface Recommendation {
  id: string;
  subBlockId: string;
  recommendationType: 'irrigate' | 'drain' | 'maintain' | 'alert_only' | 'observe' | 'skip_awd_event';
  commandText: string;
  reasonSummary: string;
  confidenceLevel: string;
  waterLevelCmAtDecision: string;
  priorityRank: number;
  priorityScore: string;
  operatorWarningText?: string;
}

interface Alert {
  id: string;
  alertType: string;
  severity: 'critical' | 'warning' | 'info';
  alertMessage: string;
  triggeredAt: string;
}

// ── Modal State Types ────────────────────────────────────────────────────────

interface SkipModalState {
  recId: string;
  subBlockId: string;
  recCommandText: string;
}

interface ConfirmModalState {
  recId: string;
  action: 'executed' | 'deferred';
  title: string;
  description: string;
}

export function DssPage() {
  const dialog = useDialog();
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [fieldSubBlocks, setFieldSubBlocks] = useState<SubBlock[]>([]);
  
  const [loadingTop, setLoadingTop] = useState(false);
  const [lastEvaluated, setLastEvaluated] = useState<string | null>(null);

  // ── Modal: Konfirmasi Eksekusi / Tunda ────────────────────────────────────
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const [confirmNotes, setConfirmNotes] = useState('');
  const [submittingConfirm, setSubmittingConfirm] = useState(false);

  // ── Modal: Abaikan + Doomsday Override ───────────────────────────────────
  const [skipModal, setSkipModal] = useState<SkipModalState | null>(null);
  const [skipReason, setSkipReason] = useState<'pematang_jebol' | 'lainnya' | ''>('');
  const [skipNotes, setSkipNotes] = useState('');
  const [skipImpactedId, setSkipImpactedId] = useState('');
  const [submittingSkip, setSubmittingSkip] = useState(false);

  // ── Modal: Catat Obat/Pupuk ───────────────────────────────────────────────
  const [showTreatmentModal, setShowTreatmentModal] = useState(false);
  const [treatmentForm, setTreatmentForm] = useState({
    treatmentType: 'fertilizer',
    productName: '',
    targetWaterLevelCm: 0,
    activeDurationHours: 72
  });

  // Load fields
  useEffect(() => {
    const fetchFields = async () => {
      try {
        const response = await apiClient.get('/fields');
        const fieldsData = response.data.data;
        setFields(fieldsData);
        if (fieldsData.length > 0) {
          setSelectedFieldId(fieldsData[0].id);
        }
      } catch (err) {
        console.error("Failed to load fields", err);
      }
    };
    fetchFields();
  }, []);

  // Fetch sub-blocks list when field changes (for Pematang Jebol dropdown)
  useEffect(() => {
    if (!selectedFieldId) { setFieldSubBlocks([]); return; }
    apiClient.get(`/fields/${selectedFieldId}/sub-blocks`)
      .then(res => setFieldSubBlocks(res.data.data || []))
      .catch(err => console.error('Failed to load sub-blocks', err));
  }, [selectedFieldId]);

  // Fetch DSS and Alerts
  const fetchDssData = async (fieldId: string) => {
    if (!fieldId) return;
    try {
      setLoadingTop(true);
      
      const [recsRes, alertsRes] = await Promise.all([
        apiClient.get(`/fields/${fieldId}/recommendations`),
        apiClient.get(`/fields/${fieldId}/alerts?active=true`)
      ]);
      
      setRecommendations(recsRes.data.data || []);
      setLastEvaluated(recsRes.data.meta?.latestEvaluatedAt || null);
      setAlerts(alertsRes.data.data || []);
      
    } catch (err) {
      console.error('Failed to fetch DSS data:', err);
    } finally {
      setLoadingTop(false);
    }
  };

  useEffect(() => {
    if (selectedFieldId) fetchDssData(selectedFieldId);
  }, [selectedFieldId]);

  // ── Open modals instead of direct submit ─────────────────────────────────

  const openConfirmModal = (rec: Recommendation, action: 'executed' | 'deferred') => {
    setConfirmNotes('');
    setConfirmModal({
      recId: rec.id,
      action,
      title: action === 'executed' ? '✅ Konfirmasi Eksekusi' : '⏳ Konfirmasi Tunda',
      description: action === 'executed'
        ? `Konfirmasikan bahwa tindakan berikut telah benar-benar dilakukan di lapangan:\n"${rec.commandText}"`
        : `Tunda rekomendasi berikut:\n"${rec.commandText}"`
    });
  };

  const openSkipModal = (rec: Recommendation) => {
    setSkipReason('');
    setSkipNotes('');
    setSkipImpactedId('');
    setSkipModal({ recId: rec.id, subBlockId: rec.subBlockId, recCommandText: rec.commandText });
  };

  // ── Submit: Eksekusi / Tunda ──────────────────────────────────────────────

  const handleConfirmFeedback = async () => {
    if (!confirmModal) return;
    try {
      setSubmittingConfirm(true);
      await apiClient.post(`/recommendations/${confirmModal.recId}/feedback`, {
        feedback_status: confirmModal.action,
        ...(confirmNotes.trim() ? { operator_notes: confirmNotes.trim() } : {})
      });
      setConfirmModal(null);
      fetchDssData(selectedFieldId);
    } catch (err: any) {
      console.error('Failed to submit feedback', err);
      await dialog.alert(err.response?.data?.message || err.response?.data?.error || 'Gagal memperbarui status rekomendasi.');
    } finally {
      setSubmittingConfirm(false);
    }
  };

  // ── Submit: Abaikan + Doomsday Override ──────────────────────────────────

  const handleConfirmSkip = async () => {
    if (!skipModal || !skipReason) return;
    try {
      setSubmittingSkip(true);
      const body: Record<string, string> = {
        feedback_status: 'skipped',
        skip_reason: skipReason,
      };
      if (skipNotes.trim()) body['operator_notes'] = skipNotes.trim();
      if (skipReason === 'pematang_jebol' && skipImpactedId) {
        body['impacted_sub_block_id'] = skipImpactedId;
      }
      await apiClient.post(`/recommendations/${skipModal.recId}/feedback`, body);
      setSkipModal(null);
      fetchDssData(selectedFieldId);
    } catch (err: any) {
      console.error('Failed to submit skip', err);
      await dialog.alert(err.response?.data?.message || err.response?.data?.error || 'Gagal memperbarui status rekomendasi.');
    } finally {
      setSubmittingSkip(false);
    }
  };

  // ── Alert Acknowledge ─────────────────────────────────────────────────────

  const handleAcknowledgeAlert = async (alertId: string) => {
    try {
      await apiClient.post(`/alerts/${alertId}/acknowledge`);
      fetchDssData(selectedFieldId);
    } catch (err) {
      console.error('Failed to acknowledge alert', err);
    }
  };

  // ── Catat Obat/Pupuk ─────────────────────────────────────────────────────

  const handleSubmitTreatment = async () => {
    if (!treatmentForm.productName) {
      await dialog.alert('Nama obat/pupuk wajib diisi');
      return;
    }
    try {
      await apiClient.post(`/fields/${selectedFieldId}/agronomic-treatments`, treatmentForm);
      setShowTreatmentModal(false);
      await dialog.alert('Perlakuan berhasil dicatat! Sistem DSS akan otomatis menyesuaikan target air sesuai durasi.');
      fetchDssData(selectedFieldId);
    } catch (err: any) {
      console.error('Failed to submit treatment', err);
      await dialog.alert(err.response?.data?.message || err.response?.data?.error || 'Gagal mencatat perlakuan.');
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const getActionColor = (action: string) => {
    switch (action) {
      case 'irrigate': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'drain': return 'bg-red-500/10 text-red-500 border-red-500/20';
      case 'maintain_wet':
      case 'maintain_dry':
      case 'maintain': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'observe':
      case 'alert_only': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      default: return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 animate-in fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Active Engine Outputs</h2>
          <p className="text-muted-foreground mt-1">
            Memonitor rekomendasi irigasi dan sistem peringatan Decision Support System).
          </p>
        </div>
      </div>

      {/* Filter Lahan */}
      <Card className="bg-muted/10 border-dashed">
        <CardContent className="py-4 flex gap-4 items-center">
          <label className="text-sm font-semibold uppercase text-muted-foreground whitespace-nowrap">
            Fokus Area:
          </label>
          <select 
            value={selectedFieldId}
            onChange={(e) => setSelectedFieldId(e.target.value)}
            className="w-full sm:w-64 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="" disabled>Pilih Lahan...</option>
            {fields.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>

          <Button variant="ghost" size="sm" onClick={() => fetchDssData(selectedFieldId)} disabled={loadingTop}>
            Refresh
          </Button>

          {selectedFieldId && (
            <Button variant="secondary" size="sm" onClick={() => setShowTreatmentModal(true)} className="ml-2">
              <Syringe className="h-4 w-4 mr-2" /> Catat Obat/Pupuk
            </Button>
          )}

          {lastEvaluated && (
            <span className="text-xs text-muted-foreground ml-auto hidden md:block">
              Update Terakhir: {new Date(lastEvaluated).toLocaleString()}
            </span>
          )}
        </CardContent>
      </Card>

      {/* ── Modal: Konfirmasi Eksekusi / Tunda ─────────────────────────────── */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{confirmModal.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                {confirmModal.description}
              </p>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">
                  Catatan Lapangan <span className="text-muted-foreground font-normal">(opsional)</span>
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                  placeholder={confirmModal.action === 'executed'
                    ? 'Misal: Pompa dinyalakan pukul 08.30, selang 3 jam...'
                    : 'Misal: Ditunda karena menunggu cuaca reda...'}
                  value={confirmNotes}
                  onChange={(e) => setConfirmNotes(e.target.value)}
                />
              </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmModal(null)} disabled={submittingConfirm}>
                Batal
              </Button>
              <Button onClick={handleConfirmFeedback} disabled={submittingConfirm}>
                {submittingConfirm
                  ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  : confirmModal.action === 'executed'
                    ? <CheckCircle className="h-4 w-4 mr-2" />
                    : <Clock className="h-4 w-4 mr-2" />
                }
                {confirmModal.action === 'executed' ? 'Konfirmasi Sudah Dikerjakan' : 'Konfirmasi Tunda'}
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}

      {/* ── Modal: Abaikan + Doomsday Override Pematang Jebol ──────────────── */}
      {skipModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="w-full max-w-lg shadow-2xl animate-in fade-in zoom-in-95">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <XSquare className="h-5 w-5 text-destructive" />
                Abaikan Rekomendasi
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                "{skipModal.recCommandText}"
              </p>
            </CardHeader>
            <CardContent className="space-y-5">

              {/* Step 1: Pilih Alasan */}
              <div className="space-y-2">
                <label className="text-sm font-semibold">Alasan Mengabaikan <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    onClick={() => setSkipReason('pematang_jebol')}
                    className={`flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                      skipReason === 'pematang_jebol'
                        ? 'border-red-500 bg-red-500/10'
                        : 'border-border hover:border-red-400 hover:bg-red-500/5'
                    }`}
                  >
                    <AlertTriangle className={`h-5 w-5 mt-0.5 shrink-0 ${skipReason === 'pematang_jebol' ? 'text-red-500' : 'text-muted-foreground'}`} />
                    <div>
                      <p className="font-semibold text-sm">🚨 Pematang Bocor / Jebol</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Sistem akan menonaktifkan rekomendasi pada petak ini secara permanen hingga diperbaiki. Wajib lapor ke manajemen.
                      </p>
                    </div>
                  </button>
                  <button
                    onClick={() => setSkipReason('lainnya')}
                    className={`flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                      skipReason === 'lainnya'
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/40 hover:bg-primary/5'
                    }`}
                  >
                    <XSquare className={`h-5 w-5 mt-0.5 shrink-0 ${skipReason === 'lainnya' ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div>
                      <p className="font-semibold text-sm">Alasan Lain</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Kondisi lapangan tidak memungkinkan atau ada pertimbangan lain dari operator.
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Step 2 (Conditional): Pilih Kotak Terdampak jika Pematang Jebol */}
              {skipReason === 'pematang_jebol' && (
                <div className="space-y-1.5 p-3 rounded-lg border border-red-500/30 bg-red-500/5 animate-in fade-in slide-in-from-top-2">
                  <label className="text-sm font-semibold text-red-600 dark:text-red-400">
                    Kotak Sawah Tetangga yang Ikut Terdampak <span className="font-normal text-muted-foreground">(opsional)</span>
                  </label>
                  <select
                    value={skipImpactedId}
                    onChange={(e) => setSkipImpactedId(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">-- Tidak ada kotak tetangga terdampak --</option>
                    {fieldSubBlocks
                      .filter(sb => sb.id !== skipModal.subBlockId)
                      .map(sb => (
                        <option key={sb.id} value={sb.id}>
                          {sb.name || sb.code}
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-red-500/80">
                    Jika dipilih, sistem akan membekukan rekomendasi di kedua kotak tersebut.
                  </p>
                </div>
              )}

              {/* Catatan Tambahan */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">
                  Catatan Tambahan <span className="text-muted-foreground font-normal">(opsional)</span>
                </label>
                <textarea
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                  placeholder={skipReason === 'pematang_jebol'
                    ? 'Misal: Pematang sisi timur jebol sepanjang 2 meter...'
                    : 'Misal: Kondisi cuaca tidak memungkinkan...'}
                  value={skipNotes}
                  onChange={(e) => setSkipNotes(e.target.value)}
                />
              </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2 border-t pt-4">
              <Button variant="ghost" onClick={() => setSkipModal(null)} disabled={submittingSkip}>
                Batal
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmSkip}
                disabled={!skipReason || submittingSkip}
              >
                {submittingSkip
                  ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  : <XSquare className="h-4 w-4 mr-2" />
                }
                {skipReason === 'pematang_jebol' ? 'Abaikan & Laporkan Jebol' : 'Konfirmasi Abaikan'}
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}

      {/* ── Modal: Catat Obat/Pupuk ─────────────────────────────────────────── */}
      {showTreatmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md shadow-lg animate-in fade-in zoom-in-95">
            <CardHeader>
              <CardTitle>Input Perlakuan Manual (Obat/Pupuk)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-semibold">Tipe Perlakuan</label>
                <select 
                  className="w-full h-9 rounded-md border px-3 text-sm"
                  value={treatmentForm.treatmentType}
                  onChange={(e) => setTreatmentForm({...treatmentForm, treatmentType: e.target.value})}
                >
                  <option value="fertilizer">Pupuk</option>
                  <option value="pesticide">Pestisida</option>
                  <option value="herbicide">Herbisida</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold">Nama Produk</label>
                <input 
                  type="text" 
                  className="w-full h-9 rounded-md border px-3 text-sm"
                  placeholder="Misal: Urea / NPK"
                  value={treatmentForm.productName}
                  onChange={(e) => setTreatmentForm({...treatmentForm, productName: e.target.value})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold">Target Tinggi Air Optimal (cm)</label>
                <input 
                  type="number" 
                  step="0.1"
                  className="w-full h-9 rounded-md border px-3 text-sm"
                  value={treatmentForm.targetWaterLevelCm}
                  onChange={(e) => setTreatmentForm({...treatmentForm, targetWaterLevelCm: parseFloat(e.target.value)})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold">Durasi Efek Target (Jam)</label>
                <input 
                  type="number" 
                  className="w-full h-9 rounded-md border px-3 text-sm"
                  value={treatmentForm.activeDurationHours}
                  onChange={(e) => setTreatmentForm({...treatmentForm, activeDurationHours: parseInt(e.target.value, 10)})}
                />
              </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowTreatmentModal(false)}>Batal</Button>
              <Button onClick={handleSubmitTreatment}>Simpan & Sesuaikan Air</Button>
            </CardFooter>
          </Card>
        </div>
      )}

      {/* ── Main Content ─────────────────────────────────────────────────────── */}
      {!selectedFieldId ? (
         <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border rounded-lg">
           <Sprout className="h-8 w-8 mb-2 opacity-50" />
           <p>Pilih Lahan untuk melihat output engine.</p>
         </div>
      ) : loadingTop ? (
         <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border rounded-lg">
           <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
           <p>Sinkronisasi AI Engine...</p>
         </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Main Column: Recommendations */}
          <div className="col-span-1 lg:col-span-2 space-y-4">
            <h3 className="text-lg font-semibold flex items-center">
              <Droplets className="h-5 w-5 mr-2 text-primary" /> 
              Rekomendasi Operasional Aktif
              <Badge variant="outline" className="ml-2 font-mono">{recommendations.length}</Badge>
            </h3>

            {recommendations.length === 0 ? (
              <Card className="border-dashed h-40 flex flex-col items-center justify-center text-muted-foreground">
                <CheckCircle className="h-8 w-8 text-emerald-500 mb-2 opacity-80" />
                <p>Kondisi lahan saat ini stabil. Tidak ada intervensi yang diperlukan.</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {recommendations.map(rec => (
                  <Card key={rec.id} className="border border-border/50 shadow-sm overflow-hidden">
                    <div className="flex">
                      <div className={`w-2 shrink-0 ${
                        rec.recommendationType === 'irrigate' ? 'bg-blue-500' :
                        rec.recommendationType === 'drain' ? 'bg-red-500' :
                        rec.recommendationType === 'observe' || rec.recommendationType === 'alert_only' ? 'bg-amber-500' :
                        'bg-emerald-500'
                      }`} />
                      <div className="flex-1">
                        <CardHeader className="py-4 pb-2">
                          <div className="flex justify-between items-start">
                            <Badge className={getActionColor(rec.recommendationType)}>
                               {rec.recommendationType.replace('_', ' ').toUpperCase()}
                            </Badge>
                            <div className="flex items-center gap-2">
                              {rec.priorityRank === 1 && (
                                <Badge variant="destructive" className="text-xs">PRIORITAS #1</Badge>
                              )}
                              <Badge variant="outline" className="opacity-80 text-xs">
                                 Keyakinan: {rec.confidenceLevel}
                              </Badge>
                            </div>
                          </div>
                          <CardTitle className="text-lg mt-2 leading-snug">
                            {rec.commandText}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="py-2 text-sm text-muted-foreground">
                          {rec.reasonSummary}
                          {rec.operatorWarningText && (
                            <div className="mt-2 flex items-start gap-2 text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-md p-2">
                              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                              <span>{rec.operatorWarningText}</span>
                            </div>
                          )}
                        </CardContent>
                        <CardFooter className="py-3 bg-muted/20 border-t flex gap-2 pt-3 mt-2">
                          <Button size="sm" variant="default" onClick={() => openConfirmModal(rec, 'executed')}>
                            <CheckCircle className="h-4 w-4 mr-2" /> Eksekusi Sekarang
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openConfirmModal(rec, 'deferred')}>
                            <Clock className="h-4 w-4 mr-2" /> Tunda
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => openSkipModal(rec)}>
                            <XSquare className="h-4 w-4 mr-2" /> Abaikan
                          </Button>
                        </CardFooter>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Side Column: Alerts */}
          <div className="col-span-1 space-y-4">
            <h3 className="text-lg font-semibold flex items-center text-amber-500">
              <ShieldAlert className="h-5 w-5 mr-2" /> 
              Sistem Peringatan
              <Badge variant="destructive" className="ml-2 font-mono">{alerts.length}</Badge>
            </h3>

            {alerts.length === 0 ? (
               <Card className="border-dashed h-40 flex flex-col items-center justify-center text-muted-foreground">
                 <Bell className="h-8 w-8 mb-2 opacity-30" />
                 <p className="text-sm">Tidak ada alarm aktif.</p>
               </Card>
            ) : (
              <div className="space-y-3">
                {alerts.map(al => (
                  <Card key={al.id} className="border-red-500/20 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-red-500" />
                    <CardHeader className="p-4 pb-2">
                      <div className="flex justify-between items-start">
                        <span className="text-xs font-semibold uppercase text-red-500">{al.alertType.replace('_', ' ')}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(al.triggeredAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-1">
                      <p className="text-sm">{al.alertMessage}</p>
                      <Button size="sm" variant="outline" className="w-full mt-4 h-8 text-xs" onClick={() => handleAcknowledgeAlert(al.id)}>
                        Acknowledge (Tutup)
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
