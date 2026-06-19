import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';

interface RuleFormData {
  name: string;
  description: string;
  bucket_code: string;
  phase_code: string;
  awd_lower_threshold_cm: number | '';
  awd_upper_target_cm: number | '';
  drought_alert_cm: number | '';
  min_saturation_days: number;
  rain_delay_mm: number;
  priority_weight: number;
  target_confidence: 'high' | 'medium' | 'low';
}

interface CreateRuleModalProps {
  isOpen: boolean;
  initialData?: any;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateRuleModal({ isOpen, initialData, onClose, onSuccess }: CreateRuleModalProps) {
  const [formData, setFormData] = useState<RuleFormData>({
    name: initialData?.name || '',
    description: initialData?.description || '',
    bucket_code: initialData?.bucketCode || 'medium',
    phase_code: initialData?.phaseCode || 'land_prep',
    awd_lower_threshold_cm: initialData?.awdLowerThresholdCm || -15,
    awd_upper_target_cm: initialData?.awdUpperTargetCm || 5,
    drought_alert_cm: initialData?.droughtAlertCm || -25,
    min_saturation_days: initialData?.minSaturationDays || 1,
    rain_delay_mm: initialData?.rainDelayMm || 10,
    priority_weight: initialData?.priorityWeight || 1,
    target_confidence: initialData?.targetConfidence || 'high'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.type === 'number' ? parseFloat(e.target.value) : e.target.value;
    setFormData(prev => ({ ...prev, [e.target.name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (initialData?.id) {
        await apiClient.patch(`/rule-profiles/${initialData.id}`, formData);
      } else {
        await apiClient.post('/rule-profiles', formData);
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Gagal menyimpan profil aturan');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
      <div className="w-full max-w-md rounded-xl bg-card text-card-foreground shadow-lg border max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b p-4 sticky top-0 bg-card z-10">
          <h2 className="text-lg font-semibold">
            {initialData ? 'Edit Profil Aturan' : 'Buat Profil Aturan AWD'}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 text-sm text-destructive-foreground bg-destructive rounded-md">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Nama Aturan *</label>
            <input 
              required
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Cth: Padi IR64 Fase Vegetatif"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Fase Tanam</label>
              <select 
                name="phase_code"
                value={formData.phase_code}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="vegetative_early">Vegetative Early</option>
                <option value="vegetative_late">Vegetative Late</option>
                <option value="reproductive">Reproductive</option>
                <option value="ripening">Ripening</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Bucket Padi</label>
              <select 
                name="bucket_code"
                value={formData.bucket_code}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                <option value="early">Early</option>
                <option value="medium_early">Medium Early</option>
                <option value="medium">Medium</option>
                <option value="late">Late</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Ambang Bawah (AWD) cm</label>
              <input 
                name="awd_lower_threshold_cm"
                type="number"
                value={formData.awd_lower_threshold_cm}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                placeholder="-15"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Target Genangan cm</label>
              <input 
                name="awd_upper_target_cm"
                type="number"
                value={formData.awd_upper_target_cm}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                placeholder="2"
              />
            </div>
          </div>

          <div className="space-y-2 hidden">
             <label className="text-sm font-medium">Deskripsi</label>
             <input name="description" value={formData.description} onChange={handleChange} className="flex h-9 w-full rounded-md border border-input" />
          </div>

          <div className="flex justify-end space-x-2 pt-4 border-t mt-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Batal
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan Profil
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
