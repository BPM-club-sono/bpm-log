export type Role = "Admin" | "Staff" | "Tech";

export interface Membre {
  id: number;
  nom: string | null;
  prenom: string | null;
  email: string;
  role: Role;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export type StatutEquipment =
  | "Fonctionnel"
  | "En_Panne"
  | "En_Reparation"
  | "Perdu"
  | "Reforme";

export interface Equipment {
  id: number;
  barcode_uid: string;
  nom: string;
  categorie_id: number | null;
  emplacement_id: number | null;
  statut_actuel: StatutEquipment;
  created_at: string;
}

export interface Categorie {
  id: number;
  nom: string;
  description: string | null;
}

export interface Emplacement {
  id: number;
  nom: string;
  zone_stockage: string | null;
}
