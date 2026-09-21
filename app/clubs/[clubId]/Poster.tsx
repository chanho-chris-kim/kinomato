import Image from "next/image";

// TMDB posters are a fixed 2:3 ratio at every size — width/height here
// are the intrinsic source dimensions next/image needs for layout, not
// the displayed size (the .poster/.thumb container controls that via
// CSS). null posterPath (every fixture film, and any real film TMDB has
// no poster for) renders nothing — a real <img>/<Image> against a path
// that doesn't resolve 404s, which is a real console error the E2E
// console-error fixture would correctly fail on, not noise to ignore.
export function Poster({
  posterPath,
  title,
  size,
}: {
  posterPath: string | null;
  title: string;
  size: 92 | 185;
}) {
  if (!posterPath) return null;
  return (
    <Image
      src={`https://image.tmdb.org/t/p/w${size}${posterPath}`}
      alt={`${title} poster`}
      width={size}
      height={Math.round(size * 1.5)}
    />
  );
}
