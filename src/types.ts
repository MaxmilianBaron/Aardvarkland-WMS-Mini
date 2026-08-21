export type Language = 'cs' | 'en' | 'ua' | 'fr' | 'de' | 'es';
export type MovementType = 'RECEIPT' | 'ISSUE' | 'MOVE' | 'COUNT';

export interface MiniProduct {
  id: string;
  sku: string;
  name: string;
  barcode: string;
  unit: string;
  minimumStock: number;
  categoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MiniCategory { id: string; name: string; createdAt: string; }

export interface MiniBatch {
  id: string;
  productId: string;
  locationId: string;
  lotNumber: string;
  expiryDate: string | null;
  quantity: number;
  createdAt: string;
  updatedAt: string;
}

export interface MiniLocation {
  id: string;
  code: string;
  name: string;
  createdAt: string;
}

export interface MiniBalance {
  productId: string;
  locationId: string;
  quantity: number;
}

export interface MiniMovement {
  id: string;
  type: MovementType;
  productId: string;
  fromLocationId: string | null;
  toLocationId: string | null;
  quantity: number;
  delta: number;
  note: string;
  batchId: string | null;
  lotNumber: string;
  expiryDate: string | null;
  createdAt: string;
}

export interface MiniState {
  schemaVersion: 3;
  warehouseName: string;
  products: MiniProduct[];
  categories: MiniCategory[];
  batches: MiniBatch[];
  locations: MiniLocation[];
  balances: MiniBalance[];
  movements: MiniMovement[];
  updatedAt: string;
  lastBackupAt?: string;
  onboardingCompleted: boolean;
}

export interface MovementInput {
  type: MovementType;
  productId: string;
  fromLocationId?: string;
  toLocationId?: string;
  quantity: number;
  note?: string;
  batchId?: string;
  lotNumber?: string;
  expiryDate?: string;
}
