import { useEffect, useState } from 'react';
import { Plus, Search, Cpu, Wifi, Loader2, AlertTriangle, Route, Info, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/api/client';
import { CreateDeviceModal } from './create-device-modal';
import { EntityDetailModal } from '@/components/entity-detail-modal';
import { useDialog } from '@/components/ui/dialog-provider';

interface Field {
  id: string;
  name: string;
}

interface Device {
  id: string;
  deviceCode: string;
  deviceType: string;
  connectionType: string;
  hardwareModel: string | null;
  serialNumber: string | null;
  deviceName: string | null;
  status: string;
  firmwareVersion: string;
  topic: string;
  subBlockId?: string | null;
  subBlockName?: string | null;
}

export function DevicesPage() {
  const dialog = useDialog();
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [detailEntity, setDetailEntity] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');

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

  const fetchDevices = async (fieldId: string) => {
    if (!fieldId) return;
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get(`/fields/${fieldId}/devices`);
      setDevices(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Gagal memuat data devices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedFieldId) fetchDevices(selectedFieldId);
    else setDevices([]);
  }, [selectedFieldId]);

  const handleDelete = async (id: string) => {
    const confirmed = await dialog.confirm('Apakah Anda yakin ingin menghapus perangkat ini dari database?');
    if (!confirmed) return;
    try {
      await apiClient.delete(`/devices/${id}`);
      if (selectedFieldId) fetchDevices(selectedFieldId);
    } catch (err: any) {
      await dialog.alert(err.response?.data?.message || 'Gagal menghapus perangkat');
    }
  };

  const filteredDevices = devices.filter(d => 
    (d.deviceName && d.deviceName.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (d.serialNumber && d.serialNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
    d.deviceCode.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6 animate-in fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Master Data: Devices</h2>
          <p className="text-muted-foreground mt-1">
            Manajemen perangkat keras (sensor, gateway, controller) yang terinstal di area lahan.
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => setIsModalOpen(true)} 
            disabled={!selectedFieldId}
          >
            <Plus className="mr-2 h-4 w-4" /> Registrasi Device
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 bg-muted/20 border-b">
          <div className="flex flex-col sm:flex-row items-center gap-4 justify-between">
            <div className="w-full sm:w-auto">
              <label className="text-xs font-semibold uppercase text-muted-foreground mb-1 block">
                Filter Area Lahan
              </label>
              <select 
                value={selectedFieldId}
                onChange={(e) => setSelectedFieldId(e.target.value)}
                className="w-full sm:w-64 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="" disabled>Pilih Lahan...</option>
                {fields.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            
            <div className="flex bg-background border px-3 py-1.5 rounded-md items-center text-sm w-full sm:w-64 shadow-sm self-end">
              <Search className="h-4 w-4 text-muted-foreground mr-2 shrink-0" />
              <input 
                placeholder="Cari SN/Label..." 
                className="bg-transparent border-none outline-none w-full text-foreground"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!selectedFieldId ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Route className="h-8 w-8 mb-2 opacity-50" />
              <p>Pilih Lahan untuk melihat perangkat yang terdaftar di lokasi tersebut.</p>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
              <p>Menghubungkan ke registry...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-destructive">
              <AlertTriangle className="h-10 w-10 mb-4" />
              <p>{error}</p>
              <Button variant="outline" className="mt-4" onClick={() => fetchDevices(selectedFieldId)}>Coba Lagi</Button>
            </div>
          ) : devices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Cpu className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-medium">Belum ada perangkat terdaftar</h3>
              <p className="text-muted-foreground max-w-sm mt-1 mb-6">
                Tidak ada hardware yang terhubung dengan lahan ini. Mulai dengan registrasi perangkat pertama.
              </p>
              <Button onClick={() => setIsModalOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Registrasi Device
              </Button>
            </div>
          ) : filteredDevices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Search className="h-8 w-8 mb-2 opacity-20" />
              <p>Tidak ada perangkat yang cocok dengan "{searchTerm}"</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-muted/50 text-muted-foreground uppercase text-xs border-b">
                  <tr>
                    <th className="px-6 py-3 font-medium">Device Code</th>
                    <th className="px-6 py-3 font-medium">Tipe Node</th>
                    <th className="px-6 py-3 font-medium">Koneksi</th>
                    <th className="px-6 py-3 font-medium">Hardware Model</th>
                    <th className="px-6 py-3 font-medium">Petak Terpasang</th>
                    <th className="px-6 py-3 font-medium">Firmware</th>
                    <th className="px-6 py-3 font-medium text-center">Status</th>
                    <th className="px-6 py-3 font-medium text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredDevices.map((dev) => (
                    <tr key={dev.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-4 font-bold text-foreground font-mono">{dev.deviceCode}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center capitalize">
                          {dev.deviceType.replace('_', ' ')}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center capitalize text-muted-foreground">
                          <Wifi className="h-3 w-3 mr-1" />
                          {dev.connectionType}
                        </div>
                      </td>
                      <td className="px-6 py-4">{dev.hardwareModel || '-'}</td>
                      <td className="px-6 py-4">
                        {dev.subBlockName ? (
                          <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                            {dev.subBlockName}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs italic">Belum terpasang</span>
                        )}
                      </td>
                      <td className="px-6 py-4 code font-mono text-xs">v{dev.firmwareVersion}</td>
                      <td className="px-6 py-4 text-center">
                        <Badge variant={dev.status === 'active' ? "default" : "destructive"}>
                          {dev.status}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-right flex justify-end gap-2">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => setDetailEntity(dev)}
                        >
                          <Info className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-primary"
                          onClick={() => {
                            setEditingDevice(dev);
                            setIsModalOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" /> 
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-destructive"
                          onClick={() => handleDelete(dev.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateDeviceModal 
        isOpen={isModalOpen} 
        fieldId={selectedFieldId}
        initialData={editingDevice}
        onClose={() => {
          setIsModalOpen(false);
          setEditingDevice(null);
        }} 
        onSuccess={() => {
          if (selectedFieldId) fetchDevices(selectedFieldId);
        }}
      />

      <EntityDetailModal 
        isOpen={!!detailEntity} 
        onClose={() => setDetailEntity(null)} 
        title="Detail Perangkat (Device)"
        data={detailEntity}
      />
    </div>
  );
}
