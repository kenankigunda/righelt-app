"""One shared-rules authority for prospective evaluation starts."""
import json
import subprocess
from .config import ROOT


def _run(request,seconds=10):
    try:
        result=subprocess.run(['node','--import','tsx','tools/ai-trainer/evaluation-start.mjs'],
            cwd=ROOT,input=json.dumps(request,allow_nan=False),text=True,capture_output=True,check=True,timeout=seconds)
        return json.loads(result.stdout)
    except (ValueError,OSError,subprocess.SubprocessError) as error:
        raise ValueError('authoritative evaluation start verification failed') from error


def expected_evaluation_starts(jobs,*,seconds=10):
    return _run({'jobs':jobs},seconds)


def verify_evaluation_game_start(job,game,*,seconds=10):
    return _run({'job':job,'game':game},seconds)
