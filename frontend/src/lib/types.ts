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
  parent_id?: number | null;
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
  equipment_externe?: boolean;
  equipment_contenant_id?: number | null;
}

export interface PrestationDetail extends Prestation {
  allocations: Allocation[];
}

export type ClotureDecision = "retourne" | "perdu" | "casse" | "ouvert";

export interface Consommable {
  equipment_id: number;
  nom: string;
  barcode_uid: string;
  stock_actuel: number;
  seuil_alerte: number;
  unite: string | null;
  en_alerte: boolean;
}

export interface VracLock {
  membre_id: number;
  membre_nom: string | null;
  expires_at: string;
  is_mine: boolean;
}

export interface VracCaisse {
  equipment_id: number;
  nom: string;
  barcode_uid: string;
  quantite_theorique: number;
  quantite_actuelle: number;
  ecart: number;
  lock: VracLock | null;
}

export interface InventaireEntry {
  id: number;
  membre_id: number;
  membre_nom: string | null;
  delta: number;
  note: string | null;
  presta_id: number | null;
  date: string;
}

export interface VracDetail extends VracCaisse {
  historique: InventaireEntry[];
}

// --- Parc unifié & fiche équipement (refonte pré-prod) ---

export type EquipmentType = "standard" | "vrac" | "consommable";

export interface VracPreview {
  quantite_theorique: number;
  quantite_actuelle: number;
  ecart: number;
  locked: boolean;
  lock_is_mine: boolean;
}

export interface ConsoPreview {
  stock_actuel: number;
  seuil_alerte: number;
  unite: string | null;
  en_alerte: boolean;
}

export interface EquipmentListItem {
  id: number;
  barcode_uid: string;
  nom: string;
  categorie_id: number | null;
  categorie_nom: string | null;
  emplacement_id: number | null;
  emplacement_nom: string | null;
  contenant_id?: number | null;
  contenant_nom?: string | null;
  est_contenant?: boolean;
  statut_actuel: StatutEquipment;
  photo_url: string | null;
  type: EquipmentType;
  externe: boolean;
  archive?: boolean;
  vrac: VracPreview | null;
  conso: ConsoPreview | null;
}

export interface VracDetailInfo {
  quantite_theorique: number;
  quantite_actuelle: number;
  ecart: number;
  lock: VracLock | null;
  historique: InventaireEntry[];
}

export interface LocationInfo {
  fournisseur_id: number | null;
  fournisseur_nom: string | null;
  reference_devis: string | null;
}

export interface TicketHistoryItem {
  id: number;
  description_panne: string | null;
  avancement: string;
  cout_estime: number | null;
  date_declaration: string;
  date_resolution: string | null;
}

export type AvancementTicket =
  | "A_faire"
  | "En_cours"
  | "En_attente_de_piece"
  | "Resolu";

export type TypeEvenementTicket =
  | "Commentaire"
  | "Changement_Statut"
  | "Changement_Cout"
  | "Ajout_Photo"
  | "Changement_Assignation";

export interface MembreLite {
  id: number;
  nom: string | null;
  prenom: string | null;
  role: Role;
}

export interface TicketPhoto {
  id: number;
  ticket_id: number;
  chemin: string;
  created_at: string;
  url: string;
}

export interface TicketEvenement {
  id: number;
  type: TypeEvenementTicket;
  commentaire: string | null;
  valeur_avant: string | null;
  valeur_apres: string | null;
  created_at: string;
  auteur: MembreLite | null;
}

export interface TicketListItem {
  id: number;
  equipment_id: number;
  equipment_nom: string;
  equipment_barcode: string;
  avancement: AvancementTicket;
  description_panne: string | null;
  cout_estime: number | null;
  date_declaration: string;
  date_resolution: string | null;
  declarant: MembreLite | null;
  assigne: MembreLite | null;
  nb_photos: number;
}

export interface TicketDetail {
  id: number;
  equipment_id: number;
  equipment_nom: string;
  equipment_barcode: string;
  avancement: AvancementTicket;
  description_panne: string | null;
  cout_estime: number | null;
  date_declaration: string;
  date_resolution: string | null;
  declarant: MembreLite | null;
  assigne: MembreLite | null;
  photos: TicketPhoto[];
  evenements: TicketEvenement[];
}

export interface ScanHistoryItem {
  id: number;
  type_action: string;
  contexte: string | null;
  membre_nom: string | null;
  emplacement_destination_id: number | null;
  date_scan: string;
}

export interface PathSegment {
  kind: "emplacement" | "contenant";
  id: number;
  nom: string;
}

export interface ContenuChild {
  id: number;
  nom: string;
  barcode_uid: string;
  type: EquipmentType;
  statut_actuel: StatutEquipment;
  photo_url: string | null;
  est_contenant: boolean;
}

export interface EquipmentDetail {
  id: number;
  barcode_uid: string;
  nom: string;
  categorie_id: number | null;
  categorie_nom: string | null;
  emplacement_id: number | null;
  emplacement_nom: string | null;
  contenant_id?: number | null;
  contenant_nom?: string | null;
  est_contenant?: boolean;
  chemin?: PathSegment[];
  contenu?: ContenuChild[];
  statut_actuel: StatutEquipment;
  photo_url: string | null;
  type: EquipmentType;
  externe: boolean;
  archive?: boolean;
  created_at: string;
  vrac: VracDetailInfo | null;
  conso: ConsoPreview | null;
  location: LocationInfo | null;
  tickets: TicketHistoryItem[];
  scans: ScanHistoryItem[];
}

export interface Fournisseur {
  id: number;
  nom: string;
  contact: string | null;
  favori?: boolean;
}

// --- Tableau de bord d'accueil ---

export interface ParcStats {
  total_actif: number;
  fonctionnel: number;
  en_panne: number;
  en_reparation: number;
  perdu: number;
  pourcentage_sante: number;
  tickets_ouverts: number;
  tickets_non_assignes: number;
  consommables_sous_seuil: number;
}

export interface PrestationCourante {
  id: number;
  nom: string;
  type: TypePrestation;
  client_nom: string | null;
  date_debut: string | null;
  date_fin: string | null;
  statut: StatutPrestation;
  responsable_nom: string | null;
  nb_objets: number;
  a_venir: boolean;
}

export type CategorieActivite = "reparation" | "scan" | "statut";

export interface ActiviteItem {
  id: string;
  categorie: CategorieActivite;
  titre: string;
  equipment_id: number;
  equipment_nom: string;
  membre_nom: string | null;
  contexte: string | null;
  date: string;
  ticket_id: number | null;
}

export interface DashboardData {
  parc: ParcStats;
  prestation: PrestationCourante | null;
  activite: ActiviteItem[];
}

