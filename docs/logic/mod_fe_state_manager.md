# 📦 TIER 5 (FrontEnd): State Manager (Zustand)

## 1. Mekanisme Kerja
Dalam aplikasi antarmuka peta *Single Page Application* yang kompleks, `props-drilling` (melempar data dari komponen Ayah ke Anak ke Cucu) akan membuat *re-render* yang mengerikan.
Oleh karena itu, modul ini akan sangat bergantung pada `Zustand` sebagai lumbung data global (*Global State Store*).

## 2. Diagram State Global & Aliran Pembaruan (*Update Flow*)
```mermaid
stateDiagram-v2
    state "useStore (Zustand)" as Store {
        User_Auth
        Current_Field_Data
        Active_Recommendations
        Offline_Nodes
    }
    
    API_Backend --> Store : GET /fields/1/status
    
    Store --> MapVisualManager : Trigger Re-render Polygons
    Store --> DashboardSidebar : Render Active_Recommendations
    Store --> Header : Render User_Auth
    
    state MapVisualManager {
        Poligon_Hijau
        Poligon_Merah
    }
    
    note right of MapVisualManager
        Jika 'Current_Field_Data' ada yang
        berstatus 'NO_DATA', komponen
        peta merespons dengan mewarnai 
        Poligon tersebut menjadi Abu-abu/Garis putus
    end note
```

## 3. Hubungan ke Modul Lain
Setiap kali `client.ts` (Modul *Axios/Fetch*) menerima data terbaru hasil kalkulasi Backend, ia menuliskannya ke Store. Komponen visual tidak menembak Backend secara langsung; ia hanya "berlangganan" (*Subscribe*) terhadap perubahan di Zustand Store.
