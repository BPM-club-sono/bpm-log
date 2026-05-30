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
