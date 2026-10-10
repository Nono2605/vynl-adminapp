import Image from "next/image";

// Logo horizontal de la DA : icône officielle à gauche, nom en Dela Gothic One
// à droite (blanc sur fond sombre). L'icône ne se déforme ni ne se recolore.
export function Logo() {
  return (
    <span className="logo">
      <Image src="/vynl-icon.png" alt="" width={36} height={36} priority />
      <span className="logo__word font-brand">Vynl</span>
    </span>
  );
}
