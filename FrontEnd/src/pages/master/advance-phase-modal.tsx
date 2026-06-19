import { useState } from 'react';
import { X, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';

export interface AdvancePhaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  cycleId: string | null;
  currentPhase: string;
}

const PHASES = [
  'land_prep', 'nursery', 'transplanting',
  'vegetative_early', 'vegetative_late',
  'reproductive', 'ripening', 'harvesting', 'harvested'
];

export function AdvancePhaseModal({ isOpen, onClose, onSuccess, cycleId, currentPhase }: AdvancePhaseModalProps) {
  // Try to find the next logical phase in sequence
  const currentIndex = PHASES.indexOf(currentPhase);
  const defaultNextPhase = currentIndex >= 0 && currentIndex < PHASES.length - 1 
    ? PHASES[currentIndex + 1] 
    : 'vegetative_early';

  const [formData, setFormData] = useState({
    current_phase_code: defaultNextPhase,
    notes: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cycleId) return;
    
    setError('');
    setLoading(true);

    try {
      await apiClient.patch(`/crop-cycles/${cycleId}/phase`, formData);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Gagal mengubah fase');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
      <div className="w-full max-w-md rounded-xl bg-card text-card-foreground shadow-lg border max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b p-4 sticky top-0 bg-card z-10">
          <h2 className="text-lg font-semibold">Ubah Fase Pertumbuhan</h2>
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
          
          <div className="flex items-center justify-center p-4 bg-muted/30 rounded-lg border border-dashed mb-4">
            <div className="text-center">
              <p className="text-xs text-muted-foreground uppercase mb-1">Saat Ini</p>
              <div className="font-semibold capitalize px-3 py-1 bg-secondary rounded text-secondary-foreground">
                {currentPhase.replace('_', ' ')}
              </div>
            </div>
            <ArrowRight className="mx-4 text-muted-foreground" />
            <div className="text-center">
               <p className="text-xs text-muted-foreground uppercase mb-1">Tujuan</p>
               <select 
                name="current_phase_code"
                value={formData.current_phase_code}
                onChange={(e) => setFormData({...formData, current_phase_code: e.target.value})}
                className="font-semibold capitalize flex h-9 rounded bg-primary text-primary-foreground border-none px-3 outline-none"
              >
                {PHASES.map(p => (
                  <option key={p} value={p}>{p.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Catatan Lapangan</label>
            <textarea 
              name="notes"
              value={formData.notes}
              onChange={(e) => setFormData({...formData, notes: e.target.value})}
              rows={3}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Catatan perpindahan fase..."
            />
          </div>

          <div className="flex justify-end space-x-2 pt-4 border-t mt-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Batal
            </Button>
            <Button type="submit" disabled={loading || !cycleId}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Konfirmasi Perubahan
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
