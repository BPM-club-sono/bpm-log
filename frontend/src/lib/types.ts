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

export type TypePrestation = "Interne" | "Externe";
export type StatutPrestation = "En_preparation" | "En_cours" | "Terminee";
export type StatutAllocation = "Planifie" | "Sorti" | "Retourne";

export interface Prestation {
  id: number;
  nom: string;
  type: TypePrestation;
  client_nom: string | null;
  date_debut: string | null;
  date_fin: string | null;
  statut: StatutPrestation;
  responsable_membre_id: number | null;
}

export interface Allocation {
  id: number;
  presta_id: number;
  equipment_id: number;
  quantite: number;
  quantite_sortie: number;
  quantite_retournee: number;
  statut: StatutAllocation;
  equipment_nom: string | null;
  equipment_barcode: string | null;
}

export interface PrestationDetail extends Prestation {
  allocations: Allocation[];
}

export type ClotureDecision = "retourne" | "perdu" | "casse" | "ouvert";
