"""Bounded exact replay verification for an archived game; never starts training."""
import argparse
import gzip
import json
from pathlib import Path
import time
from .runner import verify_game


def main():
    parser=argparse.ArgumentParser();parser.add_argument('archive',type=Path)
    parser.add_argument('--seconds',type=float,default=20);args=parser.parse_args()
    if not 0<args.seconds<=60:raise ValueError('replay check bound must be within 60 seconds')
    opener=gzip.open if args.archive.suffix=='.gz' else open
    with opener(args.archive,'rt') as stream:game=json.load(stream)
    verify_game(game,time.monotonic()+args.seconds)
    print(json.dumps({'gameId':game['id'],'decisions':len(game['decisions']),'exactReplay':True}))

if __name__=='__main__':main()
