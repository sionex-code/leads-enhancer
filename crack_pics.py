import subprocess, itertools, sys, os, time

UNRAR = r"C:\Program Files\WinRAR\UnRAR.exe"
RAR   = os.path.expanduser(r"~\Downloads\pics.rar")

# fragments the user remembers
words   = ["yaser", "ali", "yasir", "resident", "evil"]
nums    = ["6873323", "6899141"]
special = ["6873323as", "6873323.6899141", "residentevil"]

tokens = words + nums + special
seps   = ["", " ", ".", "_", "-", ",", "@"]

def case_variants(s):
    out = {s, s.lower(), s.upper(), s.capitalize()}
    return out

def gen():
    seen = set()
    # high-priority exact fragments first
    priority = ["residentevil", "resident evil", "6873323.6899141",
                "6873323as", "yaserali", "aliyaser", "yasirali"]
    for p in priority:
        for c in case_variants(p):
            if c not in seen:
                seen.add(c); yield c
    # combinations of 1..3 tokens, ordered, with separators
    for r in (1, 2, 3):
        for combo in itertools.permutations(tokens, r):
            for sep in seps:
                base = sep.join(combo)
                for c in case_variants(base):
                    if c not in seen:
                        seen.add(c); yield c

def test(pwd):
    # -p<pwd> supplies password so UnRAR never prompts; t = test
    r = subprocess.run([UNRAR, "t", "-p"+pwd, "-inul", RAR],
                       capture_output=True, text=True)
    return r.returncode == 0

def main():
    start = time.time()
    n = 0
    for pwd in gen():
        n += 1
        if test(pwd):
            print(f"\n\n*** PASSWORD FOUND ***\n>>> {pwd!r} <<<\n")
            with open(os.path.join(os.path.dirname(__file__), "FOUND_PASSWORD.txt"), "w", encoding="utf-8") as f:
                f.write(pwd + "\n")
            print(f"tried {n} candidates in {time.time()-start:.1f}s")
            return 0
        if n % 200 == 0:
            print(f"  ...{n} tried ({time.time()-start:.0f}s) last={pwd!r}", flush=True)
    print(f"\nNot found after {n} candidates ({time.time()-start:.1f}s).")
    return 1

sys.exit(main())
