"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { useMiniApp } from "./providers/MiniAppProvider";
import {
  useAccount,
  useConnect,
  useSendTransaction,
  useSignMessage,
  useSwitchChain,
  useWaitForTransactionReceipt,
} from "wagmi";
import { parseEther } from "viem";
import { base } from "wagmi/chains";
import styles from "./page.module.css";

const CREATOR_ADDRESS = "0x3a0Bbd661B5c3b30fc9291723c93C77286DE8ca5";
const LEADERBOARD_FEE_WEI = parseEther("0.000001");
const CANVAS_WIDTH = 820;
const CANVAS_HEIGHT = 520;
const DJ_TRACK_SECONDS = 60;
const DANCE_DURATION_MS = 1000;
const INVULNERABLE_MS = 10000;
const MIN_SPEED = 70;
const BASE_SPEED = 190;
const SPEED_DECAY_PER_SECOND = 1.8;

type AuthResponse = {
  success: boolean;
  user?: {
    fid: number;
    issuedAt?: number;
    expiresAt?: number;
  };
  message?: string;
};

type LeaderboardEntry = {
  fid: number;
  scoreSeconds: number;
  displayName: string;
  address: string;
  createdAt: string;
};

type BonusType = {
  id: string;
  label: string;
  speedBoost: number;
  color: string;
};

type Bonus = {
  id: string;
  type: BonusType;
  x: number;
  y: number;
};

type Rect = { x: number; y: number; w: number; h: number };

const BONUS_TYPES: BonusType[] = [
  { id: "whiskey", label: "Whiskey + Cola", speedBoost: 30, color: "#f6c768" },
  { id: "gin", label: "Gin + Tonic", speedBoost: 28, color: "#bfe8ff" },
  { id: "negroni", label: "Negroni", speedBoost: 34, color: "#ff7a5c" },
  { id: "mule", label: "Moscow Mule", speedBoost: 26, color: "#f1c27d" },
  { id: "spritz", label: "Aperol Spritz", speedBoost: 24, color: "#ffa94d" },
];

const CLUB_WALLS: Rect[] = [
  { x: 40, y: 40, w: 740, h: 20 },
  { x: 40, y: 460, w: 740, h: 20 },
  { x: 40, y: 60, w: 20, h: 400 },
  { x: 760, y: 60, w: 20, h: 400 },
];

const CLUB_OBJECTS: Rect[] = [
  { x: 100, y: 120, w: 140, h: 60 }, // speakers
  { x: 580, y: 120, w: 140, h: 60 }, // speakers
  { x: 310, y: 110, w: 200, h: 90 }, // DJ booth
  { x: 120, y: 320, w: 180, h: 80 }, // bar
  { x: 520, y: 320, w: 180, h: 80 }, // crowd
];

const DJ_ZONE: Rect = { x: 320, y: 120, w: 180, h: 70 };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function circleRectCollision(cx: number, cy: number, radius: number, rect: Rect) {
  const closestX = clamp(cx, rect.x, rect.x + rect.w);
  const closestY = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

function rectContainsPoint(rect: Rect, x: number, y: number) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function randomInRange(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function formatSeconds(value: number) {
  return value.toFixed(1);
}

export default function Home() {
  const { context, isReady } = useMiniApp();
  const { address, chain } = useAccount();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { signMessageAsync, isPending: isSignPending } = useSignMessage();
  const {
    sendTransaction,
    data: txHash,
    isPending: isSendPending,
  } = useSendTransaction();
  const { switchChain } = useSwitchChain();
  const { isLoading: isConfirming, isSuccess: isTxConfirmed } =
    useWaitForTransactionReceipt({
      hash: txHash,
    });

  const [authData, setAuthData] = useState<AuthResponse | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<Error | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [signError, setSignError] = useState("");
  const [gameMessage, setGameMessage] = useState("");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardError, setLeaderboardError] = useState("");
  const [isSubmittingScore, setIsSubmittingScore] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const keysRef = useRef<Record<string, boolean>>({});
  const animationRef = useRef<number | null>(null);

  const gameStateRef = useRef({
    isPlaying: false,
    isGameOver: false,
    startedAt: 0,
    lastTick: 0,
    elapsedMs: 0,
    lastUiUpdate: 0,
    nextBonusAt: 0,
    trackIndex: 0,
    trackChangedAt: 0,
    trackWindowUntil: 0,
    dancedThisTrack: false,
    danceProgressMs: 0,
    invulnerableUntil: 0,
    player: {
      x: 200,
      y: 260,
      radius: 14,
      boost: 0,
      boostUntil: 0,
    },
    enemy: {
      x: 620,
      y: 260,
      radius: 16,
    },
    bonuses: [] as Bonus[],
  });

  const [uiState, setUiState] = useState({
    elapsedSeconds: 0,
    trackLabel: "DJ Nova",
    trackCountdown: DJ_TRACK_SECONDS,
    invulnerableSeconds: 0,
    danceProgress: 0,
    canDance: false,
    speed: BASE_SPEED,
    isPlaying: false,
    isGameOver: false,
  });

  useEffect(() => {
    const authenticate = async () => {
      try {
        const response = await sdk.quickAuth.fetch("/api/auth");
        const data = (await response.json()) as AuthResponse;
        setAuthData(data);
      } catch (err) {
        setAuthError(err as Error);
      } finally {
        setIsAuthLoading(false);
      }
    };

    if (isReady) {
      authenticate();
    }
  }, [isReady]);

  useEffect(() => {
    let isMounted = true;
    const fetchLeaderboard = async () => {
      try {
        const response = await fetch("/api/leaderboard");
        const data = await response.json();
        if (isMounted) {
          setLeaderboard(data.entries ?? []);
        }
      } catch (error) {
        if (isMounted) {
          setLeaderboardError((error as Error).message);
        }
      }
    };
    fetchLeaderboard();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      keysRef.current[event.key.toLowerCase()] = true;
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      keysRef.current[event.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  useEffect(() => {
    if (isTxConfirmed) {
      void submitScoreAfterPayment();
    }
  }, [isTxConfirmed]);

  const currentUserName = useMemo(() => {
    return context?.user?.displayName || context?.user?.username || "Guest";
  }, [context?.user?.displayName, context?.user?.username]);

  const tracks = useMemo(
    () => [
      "DJ Nova - Pulsar Mix",
      "DJ Nova - Astro Groove",
      "DJ Nova - Neon Pulse",
      "DJ Nova - Orbit Funk",
    ],
    []
  );

  const canStartGame = signedIn && authData?.success && !isAuthLoading;

  const resetGameState = () => {
    const now = performance.now();
    gameStateRef.current = {
      isPlaying: true,
      isGameOver: false,
      startedAt: now,
      lastTick: now,
      elapsedMs: 0,
      lastUiUpdate: 0,
      nextBonusAt: now + randomInRange(4000, 8000),
      trackIndex: 0,
      trackChangedAt: now,
      trackWindowUntil: now + 12000,
      dancedThisTrack: false,
      danceProgressMs: 0,
      invulnerableUntil: 0,
      player: {
        x: 200,
        y: 260,
        radius: 14,
        boost: 0,
        boostUntil: 0,
      },
      enemy: {
        x: 620,
        y: 260,
        radius: 16,
      },
      bonuses: [],
    };
    setUiState((prev) => ({
      ...prev,
      elapsedSeconds: 0,
      trackLabel: tracks[0],
      trackCountdown: DJ_TRACK_SECONDS,
      invulnerableSeconds: 0,
      danceProgress: 0,
      canDance: true,
      speed: BASE_SPEED,
      isPlaying: true,
      isGameOver: false,
    }));
  };

  const startGame = () => {
    setGameMessage("");
    resetGameState();
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    animationRef.current = requestAnimationFrame(gameLoop);
  };

  const endGame = () => {
    const state = gameStateRef.current;
    state.isGameOver = true;
    state.isPlaying = false;
    setUiState((prev) => ({
      ...prev,
      isPlaying: false,
      isGameOver: true,
    }));
    setGameMessage("The starling got the bunny!");
  };

  const spawnBonus = () => {
    const state = gameStateRef.current;
    const type = BONUS_TYPES[Math.floor(Math.random() * BONUS_TYPES.length)];
    let x = 200;
    let y = 200;
    let attempts = 0;
    while (attempts < 20) {
      x = randomInRange(120, CANVAS_WIDTH - 120);
      y = randomInRange(140, CANVAS_HEIGHT - 120);
      const collides = [...CLUB_WALLS, ...CLUB_OBJECTS].some((rect) =>
        rectContainsPoint(rect, x, y)
      );
      if (!collides) break;
      attempts += 1;
    }
    state.bonuses.push({
      id: `bonus-${Date.now()}-${Math.random()}`,
      type,
      x,
      y,
    });
  };

  const updateGame = (now: number) => {
    const state = gameStateRef.current;
    const dt = Math.min(40, now - state.lastTick);
    state.lastTick = now;
    state.elapsedMs = now - state.startedAt;

    if (now >= state.nextBonusAt) {
      spawnBonus();
      state.nextBonusAt = now + randomInRange(7000, 12000);
    }

    const elapsedSeconds = state.elapsedMs / 1000;
    const newTrackIndex = Math.floor(elapsedSeconds / DJ_TRACK_SECONDS);
    if (newTrackIndex !== state.trackIndex) {
      state.trackIndex = newTrackIndex;
      state.trackChangedAt = now;
      state.trackWindowUntil = now + 12000;
      state.dancedThisTrack = false;
      state.danceProgressMs = 0;
    }

    const isInDanceWindow = now <= state.trackWindowUntil;
    const isInDjZone = rectContainsPoint(
      DJ_ZONE,
      state.player.x,
      state.player.y
    );
    if (isInDanceWindow && isInDjZone && !state.dancedThisTrack) {
      state.danceProgressMs += dt;
      if (state.danceProgressMs >= DANCE_DURATION_MS) {
        state.dancedThisTrack = true;
        state.danceProgressMs = DANCE_DURATION_MS;
        state.invulnerableUntil = now + INVULNERABLE_MS;
      }
    } else {
      state.danceProgressMs = Math.max(0, state.danceProgressMs - dt * 0.6);
    }

    const decaySpeed = Math.max(
      MIN_SPEED,
      BASE_SPEED - elapsedSeconds * SPEED_DECAY_PER_SECOND
    );
    if (now > state.player.boostUntil) {
      state.player.boost = 0;
    }
    const currentSpeed = decaySpeed + state.player.boost;

    let moveX = 0;
    let moveY = 0;
    const keys = keysRef.current;
    if (keys["arrowup"] || keys["w"]) moveY -= 1;
    if (keys["arrowdown"] || keys["s"]) moveY += 1;
    if (keys["arrowleft"] || keys["a"]) moveX -= 1;
    if (keys["arrowright"] || keys["d"]) moveX += 1;

    if (moveX !== 0 && moveY !== 0) {
      const inv = 1 / Math.sqrt(2);
      moveX *= inv;
      moveY *= inv;
    }

    const nextX = state.player.x + (moveX * currentSpeed * dt) / 1000;
    const nextY = state.player.y + (moveY * currentSpeed * dt) / 1000;
    const playerRectBlocked = [...CLUB_WALLS, ...CLUB_OBJECTS].some((rect) =>
      circleRectCollision(nextX, nextY, state.player.radius, rect)
    );
    if (!playerRectBlocked) {
      state.player.x = clamp(
        nextX,
        60 + state.player.radius,
        CANVAS_WIDTH - 60 - state.player.radius
      );
      state.player.y = clamp(
        nextY,
        80 + state.player.radius,
        CANVAS_HEIGHT - 80 - state.player.radius
      );
    }

    const enemySpeed = 150;
    const dx = state.player.x - state.enemy.x;
    const dy = state.player.y - state.enemy.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.1) {
      const stepX = (dx / dist) * enemySpeed * (dt / 1000);
      const stepY = (dy / dist) * enemySpeed * (dt / 1000);
      const enemyNextX = state.enemy.x + stepX;
      const enemyNextY = state.enemy.y + stepY;
      const enemyBlocked = [...CLUB_WALLS, ...CLUB_OBJECTS].some((rect) =>
        circleRectCollision(enemyNextX, enemyNextY, state.enemy.radius, rect)
      );
      if (!enemyBlocked) {
        state.enemy.x = enemyNextX;
        state.enemy.y = enemyNextY;
      }
    }

    state.bonuses = state.bonuses.filter((bonus) => {
      const hit =
        Math.hypot(state.player.x - bonus.x, state.player.y - bonus.y) < 18;
      if (hit) {
        state.player.boost = clamp(state.player.boost + bonus.type.speedBoost, 0, 120);
        state.player.boostUntil = now + 8000;
      }
      return !hit;
    });

    const playerCaught =
      Math.hypot(
        state.player.x - state.enemy.x,
        state.player.y - state.enemy.y
      ) < state.player.radius + state.enemy.radius + 2;
    if (playerCaught && now > state.invulnerableUntil) {
      endGame();
    }

    if (now - state.lastUiUpdate > 120) {
      const trackCountdown = DJ_TRACK_SECONDS - (elapsedSeconds % DJ_TRACK_SECONDS);
      setUiState({
        elapsedSeconds,
        trackLabel: tracks[state.trackIndex % tracks.length],
        trackCountdown,
        invulnerableSeconds: Math.max(0, (state.invulnerableUntil - now) / 1000),
        danceProgress: Math.min(1, state.danceProgressMs / DANCE_DURATION_MS),
        canDance: isInDanceWindow && !state.dancedThisTrack,
        speed: currentSpeed,
        isPlaying: state.isPlaying,
        isGameOver: state.isGameOver,
      });
      state.lastUiUpdate = now;
    }
  };

  const drawGame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const state = gameStateRef.current;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    gradient.addColorStop(0, "#0f0d19");
    gradient.addColorStop(0.5, "#1a1033");
    gradient.addColorStop(1, "#0b1524");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = "#2b1d4d";
    ctx.fillRect(60, 80, CANVAS_WIDTH - 120, CANVAS_HEIGHT - 160);

    ctx.fillStyle = "#1b102b";
    CLUB_WALLS.forEach((wall) => {
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    });

    ctx.fillStyle = "#2e2247";
    CLUB_OBJECTS.forEach((obj, index) => {
      ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
      if (index === 2) {
        ctx.fillStyle = "#f2b8ff";
        ctx.fillRect(obj.x + 30, obj.y + 20, obj.w - 60, 12);
        ctx.fillStyle = "#2e2247";
      }
    });

    ctx.strokeStyle = "#ff77e1";
    ctx.lineWidth = 2;
    ctx.strokeRect(DJ_ZONE.x, DJ_ZONE.y, DJ_ZONE.w, DJ_ZONE.h);

    state.bonuses.forEach((bonus) => {
      ctx.beginPath();
      ctx.fillStyle = bonus.type.color;
      ctx.arc(bonus.x, bonus.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0b0914";
      ctx.fillRect(bonus.x - 2, bonus.y - 10, 4, 10);
    });

    const invulnerable = performance.now() < state.invulnerableUntil;
    ctx.beginPath();
    ctx.fillStyle = invulnerable ? "#7ef9ff" : "#f6e6ff";
    ctx.arc(state.player.x, state.player.y, state.player.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0b0914";
    ctx.beginPath();
    ctx.arc(state.player.x - 4, state.player.y - 4, 2, 0, Math.PI * 2);
    ctx.arc(state.player.x + 4, state.player.y - 4, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#f95c5c";
    ctx.arc(state.enemy.x, state.enemy.y, state.enemy.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#260b0b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(state.enemy.x - 8, state.enemy.y - 6);
    ctx.lineTo(state.enemy.x + 8, state.enemy.y - 6);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.12)";
    for (let i = 0; i < 10; i += 1) {
      ctx.beginPath();
      ctx.arc(
        120 + i * 60,
        210 + Math.sin(i + performance.now() / 1200) * 40,
        16,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  };

  const gameLoop = (now: number) => {
    const state = gameStateRef.current;
    if (!state.isPlaying) return;
    updateGame(now);
    drawGame();
    animationRef.current = requestAnimationFrame(gameLoop);
  };

  const connectWallet = () => {
    const connector = connectors[0];
    if (!connector) return;
    connect({ connector });
  };

  const handleSignIn = async () => {
    setSignError("");
    if (!address) {
      setSignError("Connect your wallet first.");
      return;
    }
    try {
      const message = `Astro Club Run login\nWallet: ${address}\nFID: ${authData?.user?.fid ?? "unknown"}\nTime: ${new Date().toISOString()}`;
      await signMessageAsync({ message });
      setSignedIn(true);
    } catch (error) {
      setSignError((error as Error).message);
    }
  };

  const handleDirectional = (direction: "up" | "down" | "left" | "right") => {
    keysRef.current[`arrow${direction}`] = true;
    window.setTimeout(() => {
      keysRef.current[`arrow${direction}`] = false;
    }, 140);
  };

  const submitScoreAfterPayment = async () => {
    if (!txHash || !authData?.user?.fid || !address) return;
    setIsSubmittingScore(true);
    setLeaderboardError("");
    try {
      const response = await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fid: authData.user.fid,
          scoreSeconds: Math.floor(uiState.elapsedSeconds),
          address,
          txHash,
          displayName: currentUserName,
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.message ?? "Failed to submit score");
      }
      const data = await response.json();
      setLeaderboard(data.entries ?? []);
      setGameMessage("Score submitted to the leaderboard!");
    } catch (error) {
      setLeaderboardError((error as Error).message);
    } finally {
      setIsSubmittingScore(false);
    }
  };

  const handleSubmitScore = () => {
    if (!address) {
      setLeaderboardError("Connect your wallet to submit.");
      return;
    }
    if (chain?.id !== base.id) {
      switchChain({ chainId: base.id });
      setLeaderboardError("Switching to Base network...");
      return;
    }
    sendTransaction({
      to: CREATOR_ADDRESS,
      value: LEADERBOARD_FEE_WEI,
    });
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.overline}>Base Mini App</p>
          <h1 className={styles.title}>Astro Club Run</h1>
          <p className={styles.subtitle}>
            Escape the starling in the Astro nightclub. Dance for invulnerability,
            grab cocktails to keep the bunny fast, and survive the beat.
          </p>
        </div>
        <div className={styles.userCard}>
          <p className={styles.userName}>
            {currentUserName} · FID {authData?.user?.fid ?? "—"}
          </p>
          <p className={styles.userStatus}>
            {isAuthLoading
              ? "Authenticating..."
              : authData?.success
              ? "Mini app verified"
              : "Authentication failed"}
          </p>
        </div>
      </header>

      <section className={styles.panelGrid}>
        <div className={styles.card}>
          <h2>1. Login & Wallet</h2>
          <p>
            Connect your Base wallet, then sign the free login message. You need this
            to start the run.
          </p>
          <div className={styles.buttonRow}>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={connectWallet}
              disabled={!!address || isConnectPending}
            >
              {address ? "Wallet connected" : "Connect wallet"}
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={handleSignIn}
              disabled={!address || signedIn || isSignPending}
            >
              {signedIn ? "Signed in" : "Sign login"}
            </button>
          </div>
          {signError && <p className={styles.error}>{signError}</p>}
          {authError && <p className={styles.error}>{authError.message}</p>}
        </div>

        <div className={styles.card}>
          <h2>2. Club Status</h2>
          <div className={styles.statusGrid}>
            <div>
              <p className={styles.label}>Survival timer</p>
              <p className={styles.value}>{formatSeconds(uiState.elapsedSeconds)}s</p>
            </div>
            <div>
              <p className={styles.label}>DJ track</p>
              <p className={styles.value}>{uiState.trackLabel}</p>
              <p className={styles.helper}>
                Change in {formatSeconds(uiState.trackCountdown)}s
              </p>
            </div>
            <div>
              <p className={styles.label}>Bunny speed</p>
              <p className={styles.value}>{Math.round(uiState.speed)} px/s</p>
              <p className={styles.helper}>Speed slowly decays</p>
            </div>
            <div>
              <p className={styles.label}>Invulnerability</p>
              <p className={styles.value}>
                {uiState.invulnerableSeconds > 0
                  ? `${formatSeconds(uiState.invulnerableSeconds)}s`
                  : "None"}
              </p>
              <p className={styles.helper}>
                {uiState.canDance
                  ? "Dance at the DJ for 1s"
                  : "Wait for the next track"}
              </p>
            </div>
          </div>
          <div className={styles.progressRow}>
            <div className={styles.progressLabel}>Dance progress</div>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${uiState.danceProgress * 100}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.gameSection}>
        <div className={styles.canvasWrap}>
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
          />
          {!uiState.isPlaying && !uiState.isGameOver && (
            <div className={styles.overlay}>
              <h3>Astro Club Run</h3>
              <p>Use WASD or arrows. Tap the controls on mobile.</p>
              <p>Dance in the DJ zone after the track changes.</p>
              <button
                className={styles.primaryButton}
                type="button"
                onClick={startGame}
                disabled={!canStartGame}
              >
                {canStartGame ? "Start run" : "Complete login to start"}
              </button>
            </div>
          )}
          {uiState.isGameOver && (
            <div className={styles.overlay}>
              <h3>Run over</h3>
              <p>You survived {formatSeconds(uiState.elapsedSeconds)}s.</p>
              <div className={styles.buttonRow}>
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={startGame}
                >
                  Run again
                </button>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={handleSubmitScore}
                  disabled={isSendPending || isConfirming || isSubmittingScore}
                >
                  {isSendPending || isConfirming
                    ? "Processing payment..."
                    : "Pay 0.000001 ETH to submit"}
                </button>
              </div>
              <p className={styles.helper}>
                Payment goes to {CREATOR_ADDRESS.slice(0, 6)}...
                {CREATOR_ADDRESS.slice(-4)}
              </p>
              {gameMessage && <p className={styles.success}>{gameMessage}</p>}
              {leaderboardError && <p className={styles.error}>{leaderboardError}</p>}
            </div>
          )}
        </div>

        <div className={styles.controlsCard}>
          <h2>Controls</h2>
          <div className={styles.controls}>
            <button type="button" onClick={() => handleDirectional("up")}>▲</button>
            <div>
              <button type="button" onClick={() => handleDirectional("left")}>◀</button>
              <button type="button" onClick={() => handleDirectional("down")}>▼</button>
              <button type="button" onClick={() => handleDirectional("right")}>▶</button>
            </div>
          </div>
          <div className={styles.rules}>
            <h3>Club Rules</h3>
            <ul>
              <li>The bunny slows down over time.</li>
              <li>Collect cocktails to speed up.</li>
              <li>Each DJ track change opens a dance window.</li>
              <li>Dance 1s for 10s of invulnerability.</li>
              <li>Pay to submit the run to leaderboard.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className={styles.leaderboardSection}>
        <div className={styles.card}>
          <h2>Leaderboard</h2>
          {leaderboard.length === 0 && (
            <p className={styles.helper}>No scores yet. Be the first!</p>
          )}
          {leaderboard.length > 0 && (
            <div className={styles.leaderboard}>
              {leaderboard.map((entry, index) => (
                <div key={`${entry.fid}-${entry.scoreSeconds}`} className={styles.leaderboardRow}>
                  <span className={styles.rank}>#{index + 1}</span>
                  <span className={styles.playerName}>{entry.displayName || `FID ${entry.fid}`}</span>
                  <span className={styles.score}>{entry.scoreSeconds}s</span>
                </div>
              ))}
            </div>
          )}
          {leaderboardError && <p className={styles.error}>{leaderboardError}</p>}
        </div>

        <div className={styles.card}>
          <h2>DJ Booth</h2>
          <p className={styles.helper}>
            Stand in the pink outline when the track changes. Hold for 1 second
            to get invulnerability. You can do this once per track.
          </p>
          <div className={styles.trackList}>
            {tracks.map((track, index) => (
              <div key={track} className={styles.trackItem}>
                <span className={styles.trackIndex}>{index + 1}</span>
                <span>{track}</span>
              </div>
            ))}
          </div>
          <p className={styles.helper}>
            Bonus drinks: {BONUS_TYPES.map((bonus) => bonus.label).join(", ")}.
          </p>
        </div>
      </section>
    </div>
  );
}
