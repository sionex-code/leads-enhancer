"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Lock, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export default function AdminLogin() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${BASE_PATH}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Login failed");
      }
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lf flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Image src="/brand/leadsfunda-white.svg" alt="LeadsFunda" width={140} height={27} className="mb-3" priority />
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary"><Lock className="h-5 w-5" /></div>
          <CardTitle>Admin sign in</CardTitle>
          <CardDescription>Enter the admin username and password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="admin-user">Username</Label>
              <Input id="admin-user" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-pass">Password</Label>
              <Input id="admin-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-red-600">{error}</div>}
            <Button type="submit" className="w-full" disabled={busy || !username || !password}>
              {busy ? <><Loader2 size={16} className="animate-spin" /> Signing in…</> : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
