import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Maximize, Zap, ZoomIn, ZoomOut, Volume2, VolumeX, Settings, Lock, Unlock, Repeat, RotateCcw, FastForward, Rewind } from 'lucide-react';

interface CustomPlayerProps {
    videoUrl: string;
    brandingText?: string;
    onEnded?: () => void;
}

export const CustomPlayer: React.FC<CustomPlayerProps> = ({ videoUrl, brandingText = "NSTA", onEnded }) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [isPlaying, setIsPlaying] = useState(true);
    const [speed, setSpeed] = useState(1);
    const [zoom, setZoom] = useState(1.06); 
    const [showControls, setShowControls] = useState(true);
    const [isMuted, setIsMuted] = useState(false);
    const [quality, setQuality] = useState('auto');
    const [isLocked, setIsLocked] = useState(false);
    const [isLooping, setIsLooping] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    
    // Progress
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [tapFeedback, setTapFeedback] = useState<{side: 'left'|'right', id: number} | null>(null); // For Animation
    const hasResumed = useRef(false);
    const lastTap = useRef<{time: number, side: 'left'|'right'}>({time: 0, side: 'left'});

    // Extract Video ID
    let videoId = '';
    try {
        if (videoUrl.includes('youtu.be/')) videoId = videoUrl.split('youtu.be/')[1].split('?')[0];
        else if (videoUrl.includes('v=')) videoId = videoUrl.split('v=')[1].split('&')[0];
        else if (videoUrl.includes('embed/')) videoId = videoUrl.split('embed/')[1].split('?')[0];
        if (videoId && videoId.includes('?')) videoId = videoId.split('?')[0];
    } catch(e) {}
    
    const progressKey = `nst_vid_prog_${videoId}`;

    const sendCommand = (func: string, args: any[] = []) => {
        if (!iframeRef.current) return;
        iframeRef.current.contentWindow?.postMessage(JSON.stringify({
            event: 'command',
            func: func,
            args: args
        }), '*');
    };

    const togglePlay = () => {
        if (isLocked) return;
        if (isPlaying) sendCommand('pauseVideo');
        else sendCommand('playVideo');
        setIsPlaying(!isPlaying);
    };

    const changeSpeed = () => {
        const speeds = [0.5, 1, 1.25, 1.5, 2];
        const idx = speeds.indexOf(speed);
        const nextSpeed = speeds[(idx + 1) % speeds.length];
        setSpeed(nextSpeed);
        sendCommand('setPlaybackRate', [nextSpeed]);
    };

    const changeQuality = (q: string) => {
        setQuality(q);
        sendCommand('setPlaybackQuality', [q]);
        setShowSettings(false);
    };

    const toggleZoom = () => {
         if (zoom < 1.2) setZoom(1.25);
         else if (zoom < 1.4) setZoom(1.5); // "Fill"
         else setZoom(1.06); // "Fit" (ish)
    };

    const toggleLock = () => {
        setIsLocked(!isLocked);
        setShowControls(!isLocked); // Hide controls if locking
    };

    const toggleLoop = () => setIsLooping(!isLooping);

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            iframeRef.current?.parentElement?.parentElement?.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    };

    const handleSeek = (time: number) => {
        if (isLocked) return;
        const t = Math.max(0, Math.min(duration, time));
        sendCommand('seekTo', [t, true]);
        setCurrentTime(t);
    };

    const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!duration || isLocked) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const pct = Math.max(0, Math.min(1, x / rect.width));
        handleSeek(duration * pct);
    };

    const handleDoubleTap = (side: 'left' | 'right') => {
        if (isLocked) return;
        const now = Date.now();
        if (now - lastTap.current.time < 300 && lastTap.current.side === side) {
            // Double Tap Detected
            const offset = side === 'left' ? -10 : 10;
            handleSeek(currentTime + offset);
            setTapFeedback({ side, id: now }); // Trigger Animation
            setTimeout(() => setTapFeedback(null), 500);
        }
        lastTap.current = { time: now, side };
    };

    const formatTime = (t: number) => {
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const getEmbedUrl = (url: string) => {
        return `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&controls=0&modestbranding=1&rel=0&iv_load_policy=3&fs=0&playsinline=1`;
    };

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            try {
                if (typeof event.data === 'string') {
                    const data = JSON.parse(event.data);
                    
                    if (data.event === 'infoDelivery' && data.info) {
                        if (data.info.currentTime) setCurrentTime(data.info.currentTime);
                        if (data.info.duration) {
                            setDuration(data.info.duration);
                            if (!hasResumed.current && videoId) {
                                const saved = localStorage.getItem(progressKey);
                                if (saved) {
                                    const savedTime = parseFloat(saved);
                                    if (savedTime > 5 && savedTime < (data.info.duration - 10)) {
                                        sendCommand('seekTo', [savedTime, true]);
                                    }
                                }
                                hasResumed.current = true;
                            }
                        }
                        // Loop / End Logic
                        if (data.info.playerState === 0) {
                            if (isLooping) {
                                sendCommand('seekTo', [0, true]);
                                sendCommand('playVideo');
                            } else if (onEnded) {
                                onEnded();
                            }
                        }
                        if (data.info.playerState === 1) setIsPlaying(true);
                        if (data.info.playerState === 2) setIsPlaying(false);
                    }
                }
            } catch (e) {}
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [videoId, onEnded, progressKey, isLooping]);

    // Save Progress
    useEffect(() => {
        const timer = setInterval(() => {
            if (currentTime > 0) localStorage.setItem(progressKey, currentTime.toString());
        }, 5000);
        return () => clearInterval(timer);
    }, [currentTime, progressKey]);

    const progressPercent = duration ? (currentTime / duration) * 100 : 0;

    return (
        <div 
            className="relative w-full h-full bg-black group overflow-hidden select-none" 
            onMouseEnter={() => !isLocked && setShowControls(true)}
            onMouseLeave={() => setShowControls(false)}
        >
             {/* VIDEO AREA */}
             <div className="w-full h-full transition-transform duration-300 ease-out origin-center" style={{ transform: `scale(${zoom})` }}>
                <iframe 
                    ref={iframeRef}
                    src={getEmbedUrl(videoUrl)} 
                    className="w-full h-full pointer-events-none" 
                    allow="autoplay; encrypted-media; fullscreen" 
                    title="Video Player"
                />
             </div>

             {/* TOUCH GESTURE ZONES */}
             <div className="absolute inset-0 z-10 flex">
                 <div className="w-1/3 h-full relative" onClick={() => handleDoubleTap('left')}>
                     {tapFeedback?.side === 'left' && (
                         <div className="absolute inset-0 flex items-center justify-center bg-white/10 animate-ping">
                             <Rewind className="text-white w-12 h-12" />
                             <span className="text-white font-bold text-xs">-10s</span>
                         </div>
                     )}
                 </div>
                 <div className="w-1/3 h-full flex items-center justify-center cursor-pointer" onClick={togglePlay}></div>
                 <div className="w-1/3 h-full relative" onClick={() => handleDoubleTap('right')}>
                     {tapFeedback?.side === 'right' && (
                         <div className="absolute inset-0 flex items-center justify-center bg-white/10 animate-ping">
                             <FastForward className="text-white w-12 h-12" />
                             <span className="text-white font-bold text-xs">+10s</span>
                         </div>
                     )}
                 </div>
             </div>

             {/* LOCK BUTTON (Always Visible if Locked) */}
             <button 
                onClick={(e) => { e.stopPropagation(); toggleLock(); }}
                className={`absolute top-4 left-4 z-50 p-2 rounded-full backdrop-blur-md transition-all ${isLocked ? 'bg-red-500/80 text-white' : 'bg-black/30 text-white/50 hover:bg-black/50 hover:text-white'}`}
             >
                 {isLocked ? <Lock size={20} /> : <Unlock size={20} />}
             </button>

             {/* BRANDING */}
             {!isLocked && (
                 <div className="absolute top-4 right-4 z-20 pointer-events-none opacity-60 bg-black/40 px-2 py-0.5 rounded border border-white/10">
                     <span className="text-white font-black tracking-widest text-[10px] uppercase">{brandingText}</span>
                 </div>
             )}

             {/* SETTINGS MENU */}
             {showSettings && !isLocked && (
                 <div className="absolute bottom-16 right-4 z-40 bg-black/90 text-white rounded-xl p-2 w-32 border border-white/10 backdrop-blur-md animate-in slide-in-from-bottom-2">
                     <p className="text-[10px] font-bold text-slate-400 uppercase mb-2 px-2">Quality</p>
                     {['auto', '1080p', '720p', '360p'].map(q => (
                         <button 
                            key={q} 
                            onClick={(e) => { e.stopPropagation(); changeQuality(q); }}
                            className={`w-full text-left px-2 py-1.5 rounded text-xs font-bold ${quality === q ? 'bg-blue-600' : 'hover:bg-white/10'}`}
                         >
                             {q.toUpperCase()}
                         </button>
                     ))}
                 </div>
             )}

             {/* CONTROLS BAR */}
             <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-4 pt-8 z-30 flex items-center gap-4 transition-opacity duration-300 ${showControls && !isLocked ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                 
                 <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className="text-white hover:text-blue-400 transition hover:scale-110">
                     {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
                 </button>

                 <div 
                    className="flex-1 h-2 bg-white/20 rounded-full cursor-pointer mx-2 relative group/bar" 
                    onClick={(e) => { e.stopPropagation(); handleProgressBarClick(e); }}
                 >
                     <div className="absolute inset-0 flex items-center">
                        <div className="h-full bg-blue-600 rounded-full relative" style={{ width: `${progressPercent}%` }}>
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md scale-0 group-hover/bar:scale-100 transition-transform"></div>
                        </div>
                     </div>
                 </div>

                 <span className="text-[9px] text-white font-mono w-16 text-right">
                     {formatTime(currentTime)}
                 </span>

                 {/* SETTINGS GROUP */}
                 <div className="flex items-center gap-2">
                     <button onClick={(e) => { e.stopPropagation(); toggleLoop(); }} className={`transition p-1.5 rounded-lg ${isLooping ? 'text-blue-400 bg-blue-400/20' : 'text-white/70 hover:text-white'}`} title="Loop">
                         <Repeat size={16} />
                     </button>

                     <button onClick={(e) => { e.stopPropagation(); changeSpeed(); }} className="text-white text-[10px] font-bold bg-white/10 px-2 py-1 rounded hover:bg-white/20 flex items-center gap-1 w-12 justify-center">
                         <Zap size={10} /> {speed}x
                     </button>

                     <button onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); }} className="text-white hover:text-blue-400 transition p-1">
                         <Settings size={18} />
                     </button>

                     <button onClick={(e) => { e.stopPropagation(); toggleZoom(); }} className="text-white hover:text-blue-400 transition p-1">
                         {zoom > 1.2 ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
                     </button>

                     <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} className="text-white hover:text-blue-400 transition p-1">
                         <Maximize size={18} />
                     </button>
                 </div>
             </div>
        </div>
    );
};
