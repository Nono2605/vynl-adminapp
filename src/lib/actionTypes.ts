// Résultat d'une action d'administration, tel que le voit le formulaire. Fichier
// sans « server-only » : les composants client en importent le type.
export interface ActionState {
  ok?: boolean;
  message?: string;
  error?: string;
  // Valeur à montrer UNE fois à l'admin (mot de passe temporaire). Jamais
  // journalisée, jamais stockée.
  secret?: string;
}

export type ServerAction = (state: ActionState | undefined, formData: FormData) => Promise<ActionState>;
