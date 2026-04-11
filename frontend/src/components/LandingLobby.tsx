/**
 * Landing + Lobby screen.
 *
 * Shows before the user has joined. Lets them enter a display name,
 * see seat/audience counts, and choose to join as participant or audience.
 */

interface Props {
  seatsOccupied: number;
  audienceCount: number;
  onJoin: (name: string, role: "participant" | "audience") => void;
}

export default function LandingLobby(_props: Props) {
  // TODO
  return <div>LandingLobby</div>;
}
