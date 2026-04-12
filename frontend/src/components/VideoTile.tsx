import { useCallback } from "react";

interface Props {
  name?: string;
  stream?: MediaStream;
  isLocal?: boolean;
  hasVideo?: boolean;
}

export default function VideoTile({ name, stream, isLocal, hasVideo }: Props) {
  // Callback ref: fires whenever the element mounts/remounts OR when stream
  // changes (useCallback recreates the ref fn, React calls it with the element).
  const videoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el) el.srcObject = stream ?? null;
    },
    [stream]
  );

  return (
    <div className="relative bg-gray-800 rounded-xl overflow-hidden aspect-video w-full flex items-center justify-center">
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center gap-2 text-gray-500">
          {hasVideo && <svg className="w-8 h-8 sm:w-10 sm:h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z"
            />
          </svg>}
          {name && <span className="text-xs sm:text-sm">{name}</span>}
        </div>
      )}

      {name && stream && (
        <div className="absolute bottom-1.5 left-2 bg-black/60 rounded px-2 py-0.5 text-xs text-white truncate max-w-[80%]">
          {name}{isLocal && " (you)"}
        </div>
      )}
    </div>
  );
}
