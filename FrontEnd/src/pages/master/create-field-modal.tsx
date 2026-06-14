import { useEffect, useRef, useState } from 'react';
import { X, Loader2, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { videoOpsApi } from '@/api/gisProc';

interface FieldFormData {
  name: string;
  description: string;
  adm4_code: string;
  area_hectares: number | '';
  decision_cycle_mode: string;
}

interface CreateFieldModalProps {
  isOpen: boolean;
  initialData?: any;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateFieldModal({ isOpen, initialData, onClose, onSuccess }: CreateFieldModalProps) {
  const [formData, setFormData] = useState<FieldFormData>({
    name: initialData?.name || '',
    description: initialData?.description || '',
    adm4_code: initialData?.adm4Code || '320000',
    area_hectares: initialData?.areaHectares || '',
    decision_cycle_mode: initialData?.decisionCycleMode || 'normal'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [currentUserId, setCurrentUserId] = useState<string>('');

  useEffect(() => {
    apiClient.get('/auth/me').then((res) => {
      setCurrentUserId(res.data.data.id);
    }).catch(() => {
      // silently fail; upload will be skipped if userId is empty
    });
  }, []);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.type === 'number' ? parseFloat(e.target.value) : e.target.value;
    setFormData(prev => ({
      ...prev,
      [e.target.name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const payload = {
        ...formData,
        area_hectares: formData.area_hectares === '' ? undefined : formData.area_hectares,
        ...(videoFile ? { assigned_file_name: videoFile.name } : {})
      };
      
      if (initialData?.id) {
        await apiClient.patch(`/fields/${initialData.id}`, payload);
      } else {
        await apiClient.post('/fields', payload);
      }

      if (videoFile && currentUserId) {
        try {
          await videoOpsApi.uploadVideo(currentUserId, videoFile);
        } catch (videoErr: any) {
          setError(videoErr.response?.data?.message || videoErr.message || 'Lahan tersimpan, tetapi gagal mengupload video');
          onSuccess();
          return;
        }
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Gagal menyimpan data lahan');
    } finally {
      setLoading(false);
    }
  };

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setVideoFile(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
      <div className="w-full max-w-md rounded-xl bg-card text-card-foreground shadow-lg border">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">
            {initialData ? 'Edit Data Lahan' : 'Tambah Lahan Baru (Field)'}
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
            <label className="text-sm font-medium">Nama Lahan *</label>
            <input 
              required
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Contoh: Sawah Utara Blok A"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Deskripsi</label>
            <input 
              name="description"
              value={formData.description}
              onChange={handleChange}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Keterangan operasional"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Luas (Hektar)</label>
              <input 
                name="area_hectares"
                type="number"
                step="0.01"
                min="0"
                value={formData.area_hectares}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Kode Area (ADM4) *</label>
              <input 
                required
                name="adm4_code"
                value={formData.adm4_code}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Cth: 320101"
              />
            </div>
          </div>

          <div className="space-y-2">
             <label className="text-sm font-medium">Siklus DSS Mode</label>
             <select 
               name="decision_cycle_mode"
               value={formData.decision_cycle_mode}
               onChange={handleChange}
               className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
             >
               <option value="normal">Normal</option>
               <option value="siaga">Siaga</option>
             </select>
          </div>

          {/* Video Upload */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Video Lahan (.mp4)</label>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => videoInputRef.current?.click()}
                className="flex items-center gap-2"
              >
                <Video className="h-4 w-4" />
                Upload Video
              </Button>
              <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                {videoFile ? videoFile.name : 'Belum ada file dipilih'}
              </span>
            </div>
            <input
              ref={videoInputRef}
              type="file"
              accept="video/mp4"
              className="hidden"
              onChange={handleVideoSelect}
            />
          </div>

          <div className="flex justify-end space-x-2 pt-4 border-t mt-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Batal
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
