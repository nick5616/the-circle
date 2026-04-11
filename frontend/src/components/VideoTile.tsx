/**
 * Single video tile. Shows a <video> element + name label.
 * Renders a placeholder when no seat/stream is present.
 * Local participant's video is muted to avoid echo.
 */

interface Props {
  name?: string;
  stream?: MediaStream;
  isLocal?: boolean;
}

export default function VideoTile(_props: Props) {
  // TODO
  return <div>VideoTile</div>;
}
