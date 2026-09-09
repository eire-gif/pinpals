/**
 * OpenStreetMap credit.
 *
 * Not decoration and not optional: the course directory's names, positions
 * and websites are imported from OpenStreetMap, which is published under the
 * Open Database Licence. That licence requires the source to be credited
 * wherever the data is shown. This component exists so the credit is one
 * import rather than a string somebody eventually forgets to copy onto a new
 * page — if you add a page that renders course data, add this to it.
 */
export default function OsmAttribution({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-ink-500 ${className}`}>
      Course names, locations and websites come from{" "}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-ink-900"
      >
        © OpenStreetMap contributors
      </a>
      . Spotted something wrong?{" "}
      <a href="mailto:info@pinpals.ie?subject=Course%20directory%20correction" className="underline hover:text-ink-900">
        Tell us
      </a>{" "}
      and we&rsquo;ll fix it.
    </p>
  );
}
