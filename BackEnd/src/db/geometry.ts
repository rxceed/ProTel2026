import { customType } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Custom PostGIS geometry types untuk Drizzle ORM
// Drizzle tidak punya native PostGIS support — definisikan sebagai customType
// Value disimpan sebagai string (GeoJSON atau WKT) dari PostgreSQL
// ---------------------------------------------------------------------------

/** Geometry POINT dengan SRID 4326 (WGS84) */
export const geometryPoint = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'text';
  },
  fromDriver: (v: string) => v,
  toDriver: (v: string) => v,
});

/** Geometry POLYGON dengan SRID 4326 (WGS84) */
export const geometryPolygon = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'text';
  },
  fromDriver: (v: string) => v,
  toDriver: (v: string) => v,
});

/** Generic GEOMETRY (untuk bounds/area) */
export const geometry = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'text';
  },
  fromDriver: (v: string) => v,
  toDriver: (v: string) => v,
});
