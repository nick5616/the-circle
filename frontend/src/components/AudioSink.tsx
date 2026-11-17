import { memo, useEffect, useRef } from "react";

interface Props {
  streams: Map<string, MediaStream>;
  screens: Map<string, MediaStream>; // shared-screen streams carry tab audio
  myId: string;
  onBlocked: () => void;
}

// Remote audio plays through its own hidden <audio> elements, never through
// the tile's <video>. So a camera turning off, a tile re-mounting or a layout
// change can never cut someone's voice. Video elements are always muted.
function AudioSink({ streams, screens, myId, onBlocked }: Props) {
  return (
    <div hidden>
      {[...streams].filter(([sid]) => sid !== myId).map(([sid, stream]) => (
        <RemoteAudio key={sid} stream={stream} onBlocked={onBlocked} />
      ))}
      {[...screens].filter(([sid]) => sid !== myId).map(([sid, stream]) => (
        <RemoteAudio key={`screen-${sid}`} stream={stream} onBlocked={onBlocked} kind="screen" />
      ))}
    </div>
  );
}

function RemoteAudio({ stream, onBlocked, kind = "voice" }: { stream: MediaStream; onBlocked: () => void; kind?: "voice" | "screen" }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.srcObject = stream;
    const play = () =>
      el.play().catch((err: DOMException) => {
        if (err?.name === "NotAllowedError") onBlocked();
      });
    play();
    stream.addEventListener("addtrack", play);
    return () => stream.removeEventListener("addtrack", play);
  }, [stream, onBlocked]);
  return <audio ref={ref} autoPlay data-testid={kind === "voice" ? "remote-audio" : "screen-audio"} />;
}

export default memo(AudioSink);
