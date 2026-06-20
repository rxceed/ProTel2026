import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient, gisProcClient } from '@/api/client';

interface DeviceFormData {
  device_code: string;
  device_type: string;
  hardware_model: string;
  serial_number: string;
  firmware_version: string;
  notes: string;
}

interface CreateDeviceModalProps {
  isOpen: boolean;
  fieldId: string | null;
  initialData?: any;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateDeviceModal({ isOpen, fieldId, initialData, onClose, onSuccess }: CreateDeviceModalProps) {
  const [formData, setFormData] = useState<DeviceFormData>({
    device_code: initialData?.deviceCode || '',
    device_type: initialData?.deviceType || 'sensor',
    hardware_model: initialData?.hardwareModel || '',
    serial_number: initialData?.serialNumber || '',
    firmware_version: initialData?.firmwareVersion || '1.0.0',
    notes: initialData?.notes || ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [stations, setStations] = useState<any[]>([]);
  const [selectedParentId, setSelectedParentId] = useState('');
  const [selectedIndex, setSelectedIndex] = useState('');

  // Sync initialData with state when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({
        device_code: initialData?.deviceCode || '',
        device_type: initialData?.deviceType || 'sensor',
        hardware_model: initialData?.hardwareModel || '',
        serial_number: initialData?.serialNumber || '',
        firmware_version: initialData?.firmwareVersion || '1.0.0',
        notes: initialData?.notes || ''
      });
      const deviceCode = initialData?.deviceCode || '';
      const lastUnderscoreIndex = deviceCode.lastIndexOf('_');
      const indexPart = lastUnderscoreIndex !== -1 ? deviceCode.substring(lastUnderscoreIndex + 1) : '';
      setSelectedParentId(initialData?.parentStation || '');
      setSelectedIndex(indexPart ? (parseInt(indexPart, 10) + 1).toString() : '');
      setError('');
    }
  }, [isOpen, initialData]);

  // Fetch available stations in the field
  useEffect(() => {
    if (!isOpen || !fieldId) return;
    const fetchStations = async () => {
      try {
        const response = await apiClient.get(`/fields/${fieldId}/devices`);
        const allDevices = response.data.data;
        const fieldStations = allDevices.filter((d: any) => d.deviceType === 'station');
        setStations(fieldStations);
      } catch (err) {
        console.error("Gagal memuat daftar stasiun", err);
      }
    };
    fetchStations();
  }, [isOpen, fieldId]);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fieldId) {
      setError("Field ID tidak valid.");
      return;
    }
    setError('');
    setLoading(true);

    const selectedParentStation = stations.find(st => st.id === selectedParentId);
    const parentCode = selectedParentStation ? selectedParentStation.deviceCode : '';

    const payload = {
      ...formData,
      device_code: formData.device_type === 'sensor'
        ? `${parentCode}_${parseInt(selectedIndex, 10) - 1}`
        : formData.device_code,
      parent_station: formData.device_type === 'sensor' && selectedParentId
        ? selectedParentId
        : null
    };

    try {
      if (initialData?.id) {
        await apiClient.patch(`/devices/${initialData.id}`, payload);
      } else {
        const response = await apiClient.post(`/fields/${fieldId}/devices`, payload);
        const topic = response.data?.data?.topic;
        if (topic) {
          await gisProcClient.post('/api/mqtt/subscribe', { topic });
        }
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Gagal menyimpan device');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
      <div className="w-full max-w-md rounded-xl bg-card text-card-foreground shadow-lg border max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b p-4 sticky top-0 bg-card z-10">
          <h2 className="text-lg font-semibold">
            {initialData ? 'Edit Perangkat' : 'Registrasi Device Baru'}
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

          {formData.device_type !== 'sensor' && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Device Code *</label>
              <input 
                required
                name="device_code"
                value={formData.device_code}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Cth: AWD-SEN-001"
              />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Device Type *</label>
            <select
              name="device_type"
              value={formData.device_type}
              onChange={handleChange}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="sensor">Sensor</option>
              <option value="station">Station</option>
            </select>
          </div>

          {formData.device_type === 'sensor' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Parent Station *</label>
                <select
                  required
                  value={selectedParentId}
                  onChange={(e) => {
                    setSelectedParentId(e.target.value);
                    if (!e.target.value) setSelectedIndex('');
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Pilih Station...</option>
                  {stations.map(st => (
                    <option key={st.id} value={st.id}>{st.deviceCode}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Sensor Index *</label>
                <select
                  required
                  disabled={!selectedParentId}
                  value={selectedIndex}
                  onChange={(e) => setSelectedIndex(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                >
                  <option value="">Pilih Index...</option>
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map(idx => (
                    <option key={idx} value={idx}>{idx}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Model Hardware</label>
              <input 
                name="hardware_model"
                value={formData.hardware_model}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                placeholder="PROTEL-V2"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Serial Number</label>
              <input 
                name="serial_number"
                value={formData.serial_number}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                placeholder="SN-123456"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Versi Firmware</label>
            <input 
              name="firmware_version"
              value={formData.firmware_version}
              onChange={handleChange}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              placeholder="1.0.0"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-4 border-t mt-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Batal
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrasi Device
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
