import { useState } from 'react';
import { X, Loader2, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';

export interface CreateCycleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  subBlockId: string | null;
}

export function CreateCycleModal({ isOpen, onClose, onSuccess, subBlockId }: CreateCycleModalProps) {
  const [formData, setFormData] = useState({
    bucket_code: 'medium',
    variety_name: '',
    planting_date: new Date().toISOString().split('T')[0],
    expected_harvest_date: '',
    notes: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subBlockId) return;
    
    setError('');
    setLoading(true);

    try {
      const payload: any = { ...formData };
      if (!payload.expected_harvest_date) {
        delete payload.expected_harvest_date;
      }

      await apiClient.post(`/sub-blocks/${subBlockId}/crop-cycles`, payload);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Gagal memulai musim tanam');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
      <div className="w-full max-w-md rounded-xl bg-card text-card-foreground shadow-lg border max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b p-4 sticky top-0 bg-card z-10">
          <h2 className="text-lg font-semibold">Mulai Musim Tanam Baru</h2>
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
            <label className="text-sm font-medium">Nama Varietas Padi</label>
            <input 
              required
              name="variety_name"
              value={formData.variety_name}
              onChange={handleChange}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Cth: IR64, Ciherang, Inpari 32"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Kategori Durasi Padi</label>
            <select 
              name="bucket_code"
              value={formData.bucket_code}
              onChange={handleChange}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="early">Genjah (&lt; 105 Hari)</option>
              <option value="medium_early">Sedang-Genjah (105-115 Hari)</option>
              <option value="medium">Sedang (115-125 Hari)</option>
              <option value="medium_late">Sedang-Dalam (125-135 Hari)</option>
              <option value="late">Dalam (&gt; 135 Hari)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center">
                <Calendar className="h-4 w-4 mr-1 text-muted-foreground" />
                Tanggal Tanam
              </label>
              <input 
                required
                name="planting_date"
                type="date"
                value={formData.planting_date}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-2">
               <label className="text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis">Estimasi Panen</label>
              <input 
                name="expected_harvest_date"
                type="date"
                value={formData.expected_harvest_date}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm text-muted-foreground"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Catatan (Pilihan)</label>
            <textarea 
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={2}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
              placeholder="Cth: Ditanam saat musim hujan awal"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-4 border-t mt-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Batal
            </Button>
            <Button type="submit" disabled={loading || !subBlockId}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Mulai Siklus
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
