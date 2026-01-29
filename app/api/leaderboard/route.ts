import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseEther } from "viem";
import { base } from "viem/chains";

const CREATOR_ADDRESS = "0x3a0Bbd661B5c3b30fc9291723c93C77286DE8ca5";
const LEADERBOARD_FEE_WEI = parseEther("0.000001");
const MAX_SCORE_SECONDS = 3600;

type LeaderboardEntry = {
  fid: number;
  scoreSeconds: number;
  displayName: string;
  address: string;
  createdAt: string;
};

type LeaderboardStore = {
  astroLeaderboard?: LeaderboardEntry[];
};

const store = globalThis as LeaderboardStore;
const leaderboard = store.astroLeaderboard ?? [];
store.astroLeaderboard = leaderboard;

const publicClient = createPublicClient({
  chain: base,
  transport: http(),
});

function normalizeAddress(address: string) {
  return address.toLowerCase();
}

function isValidEntry(entry: LeaderboardEntry) {
  return (
    Number.isFinite(entry.fid) &&
    Number.isFinite(entry.scoreSeconds) &&
    entry.scoreSeconds > 0 &&
    entry.scoreSeconds <= MAX_SCORE_SECONDS &&
    entry.address.length > 0
  );
}

export async function GET() {
  const sorted = [...leaderboard].sort(
    (a, b) => b.scoreSeconds - a.scoreSeconds
  );
  return NextResponse.json({ entries: sorted.slice(0, 20) });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const fid = Number(body.fid);
    const scoreSeconds = Number(body.scoreSeconds);
    const address = String(body.address ?? "");
    const txHash = String(body.txHash ?? "");
    const displayName = String(body.displayName ?? "Guest");

    if (!fid || !scoreSeconds || !address || !txHash) {
      return NextResponse.json(
        { message: "Missing fid, score, address, or txHash." },
        { status: 400 }
      );
    }

    const entry: LeaderboardEntry = {
      fid,
      scoreSeconds,
      address,
      displayName,
      createdAt: new Date().toISOString(),
    };

    if (!isValidEntry(entry)) {
      return NextResponse.json(
        { message: "Invalid score submission." },
        { status: 400 }
      );
    }

    const [tx, receipt] = await Promise.all([
      publicClient.getTransaction({ hash: txHash as `0x${string}` }),
      publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` }),
    ]);

    if (!tx.to || normalizeAddress(tx.to) !== normalizeAddress(CREATOR_ADDRESS)) {
      return NextResponse.json(
        { message: "Payment must go to the creator address." },
        { status: 400 }
      );
    }

    if (tx.value < LEADERBOARD_FEE_WEI) {
      return NextResponse.json(
        { message: "Payment amount is too low." },
        { status: 400 }
      );
    }

    if (normalizeAddress(tx.from) !== normalizeAddress(address)) {
      return NextResponse.json(
        { message: "Payment wallet does not match the submitted address." },
        { status: 400 }
      );
    }

    if (receipt.status !== "success") {
      return NextResponse.json(
        { message: "Payment transaction failed." },
        { status: 400 }
      );
    }

    const existing = leaderboard.find((item) => item.fid === fid);
    if (!existing || entry.scoreSeconds > existing.scoreSeconds) {
      if (existing) {
        Object.assign(existing, entry);
      } else {
        leaderboard.push(entry);
      }
    }

    const sorted = [...leaderboard].sort(
      (a, b) => b.scoreSeconds - a.scoreSeconds
    );
    return NextResponse.json({ entries: sorted.slice(0, 20) });
  } catch (error) {
    return NextResponse.json(
      { message: (error as Error).message ?? "Server error." },
      { status: 500 }
    );
  }
}
