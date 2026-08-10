export function Avatar({ name, photoUrl, size = 'medium' }: {
  name: string;
  photoUrl?: string | null | undefined;
  size?: 'large' | 'medium' | 'small';
}) {
  const initial = name.trim().charAt(0).toLocaleUpperCase('pt-BR') || '?';
  return (
    <span className={`avatar avatar--${size}`} aria-label={`Foto de ${name}`}>
      {photoUrl === undefined || photoUrl === null
        ? <span aria-hidden="true">{initial}</span>
        : <img alt="" referrerPolicy="no-referrer" src={photoUrl} />}
    </span>
  );
}
