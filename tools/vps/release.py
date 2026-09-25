#!/usr/bin/env python3
"""Root-owned CI-gated pull deployment. Build code as foodproxy, never as root."""
import argparse, fcntl, json, os, re, shutil, subprocess, tempfile, time, urllib.request
from pathlib import Path

REPO='SpiritusMalus/Driftora'
BASE=Path('/opt/healthroutine-food')
STATE=Path('/var/lib/driftora-release')
MIRROR=STATE/'source.git'
RELEASES=BASE/'.releases'
DROPIN=Path('/etc/systemd/system/healthroutine-food.service.d/50-release.conf')
SERVICE='healthroutine-food'

def command(args,**kwargs):
    r=subprocess.run([str(a) for a in args],capture_output=True,text=True,**kwargs)
    if r.returncode:raise RuntimeError('Command failed: '+str(args[0])+' (see protected release logs)')
    return r.stdout.strip()

def api(path):
    request=urllib.request.Request('https://api.github.com/repos/'+REPO+'/'+path,headers={'User-Agent':'driftora-release','Accept':'application/vnd.github+json'})
    with urllib.request.urlopen(request,timeout=30) as response:return json.load(response)

def ci_passed(sha):
    runs=api('actions/workflows/ci.yml/runs?head_sha='+sha+'&branch=master&event=push&per_page=10')['workflow_runs']
    eligible=[r for r in runs if r['head_sha']==sha and r['head_branch']=='master' and r['event']=='push']
    latest=max(eligible,key=lambda r:(r.get('run_number',0),r.get('run_attempt',1)),default=None)
    return bool(latest and latest['status']=='completed' and latest['conclusion']=='success')

def health(url):
    for _ in range(20):
        try:
            with urllib.request.urlopen(url,timeout=3) as response:
                if response.status==200 and json.load(response).get('status')=='ok':return True
        except Exception:pass
        time.sleep(1)
    return False

def safe_members(archive):
    for member in archive.getmembers():
        p=Path(member.name)
        if p.is_absolute() or '..' in p.parts or not (member.isfile() or member.isdir()):raise RuntimeError('Unsafe release archive entry')
    return archive.getmembers()

def release(sha):
    import tarfile
    if not re.fullmatch('[0-9a-f]{40}',sha):raise RuntimeError('Invalid commit')
    if command(['git','--git-dir',MIRROR,'rev-parse','refs/heads/master'])!=sha:raise RuntimeError('Not current master')
    if not ci_passed(sha):return {'state':'waiting-for-ci','desired':sha}
    RELEASES.mkdir(exist_ok=True,mode=0o755);RELEASES.chmod(0o755)
    target=RELEASES/sha
    if not target.exists():
        stage=Path(tempfile.mkdtemp(prefix='build-',dir=RELEASES))
        try:
            archive=STATE/'source.tar'
            with archive.open('wb') as out:
                subprocess.run(['git','--git-dir',str(MIRROR),'archive',sha,'server'],stdout=out,check=True)
            with tarfile.open(archive) as tf:tf.extractall(stage,members=safe_members(tf),filter='data')
            candidate=stage/'server'
            command(['chown','-R','foodproxy:foodproxy',stage])
            command(['install','-d','-o','foodproxy','-g','foodproxy','/var/cache/driftora-release'])
            log=STATE/('build-'+sha+'.log')
            with log.open('w') as output:
                for args in [['npm','ci'],['npm','run','build'],['npm','prune','--omit=dev']]:
                    r=subprocess.run(['runuser','-u','foodproxy','--','/usr/bin/env','npm_config_cache=/var/cache/driftora-release',*args],cwd=candidate,stdout=output,stderr=subprocess.STDOUT)
                    if r.returncode:raise RuntimeError('Build failed; protected log '+str(log))
            # Runtime state and credentials keep their existing authoritative locations.
            if (candidate/'data').exists():shutil.rmtree(candidate/'data')
            (candidate/'data').symlink_to(BASE/'data',target_is_directory=True)
            candidate.rename(target)
            (target/'RELEASE_SHA').write_text(sha+'\n')
        finally:shutil.rmtree(stage,ignore_errors=True)
    probe='driftora-release-probe'
    command(['systemd-run','--unit='+probe,'--collect','--property=User=foodproxy','--property=Group=foodproxy','--property=WorkingDirectory='+str(target),'--property=EnvironmentFile='+str(BASE/'.env'),'/usr/bin/env','PORT=18787','HOST=127.0.0.1','/usr/bin/node','dist/server.js'])
    try:
        if not health('http://127.0.0.1:18787/health'):raise RuntimeError('Candidate health check failed')
    finally:subprocess.run(['systemctl','stop',probe],capture_output=True)
    # A new master arriving during build is handled on the next tick; never roll back to an older build.
    command(['git','--git-dir',MIRROR,'fetch','origin'])
    if command(['git','--git-dir',MIRROR,'rev-parse','refs/heads/master'])!=sha:return {'state':'superseded','desired':sha}
    activate(target)
    return {'state':'deployed','sha':sha,'runtime_sha':sha,'code_tree':command(['git','--git-dir',MIRROR,'rev-parse',sha+':server']),'verified_at':time.time()}

def activate(target):
    old=DROPIN.read_bytes() if DROPIN.exists() else None
    DROPIN.parent.mkdir(parents=True,exist_ok=True)
    tmp=DROPIN.with_suffix('.new');tmp.write_text('[Service]\nWorkingDirectory='+str(target)+'\n');tmp.replace(DROPIN)
    try:
        command(['systemctl','daemon-reload']);command(['systemctl','restart',SERVICE])
        pid=command(['systemctl','show',SERVICE,'--property=MainPID','--value'])
        if Path('/proc/'+pid+'/cwd').resolve()!=target.resolve():raise RuntimeError('Wrong process version after restart')
        if not health('http://127.0.0.1:8787/health') or not health('https://food.family-pie.ru/health'):raise RuntimeError('Live health check failed')
    except Exception:
        if old is None:DROPIN.unlink(missing_ok=True)
        else:DROPIN.write_bytes(old)
        command(['systemctl','daemon-reload']);command(['systemctl','restart',SERVICE])
        raise

def main():
    os.umask(0o077);STATE.mkdir(parents=True,exist_ok=True)
    with (STATE/'lock').open('w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return
        if not MIRROR.exists():command(['git','clone','--mirror','https://github.com/'+REPO+'.git',MIRROR])
        else:command(['git','--git-dir',MIRROR,'fetch','origin'])
        sha=command(['git','--git-dir',MIRROR,'rev-parse','refs/heads/master'])
        previous=json.loads((STATE/'status.json').read_text()) if (STATE/'status.json').exists() else {}
        if previous.get('state')=='deployed' and previous.get('sha')==sha:return
        tree=command(['git','--git-dir',MIRROR,'rev-parse',sha+':server'])
        if previous.get('state')=='deployed' and previous.get('code_tree')==tree and ci_passed(sha):
            result={**previous,'sha':sha,'verified_at':time.time()}
        else:result=release(sha)
        (STATE/'status.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))

if __name__=='__main__':main()
