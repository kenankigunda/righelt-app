"""Count observed fallback decisions without inferring unrecorded history."""
def add_game(report, game):
    report.setdefault('schema',1)
    groups=report.setdefault('groups',{})
    profiles={}
    for decision in game['decisions']:
        profile=decision.get('profileVersion','legacy-unknown')
        profiles.setdefault(profile,[]).append(decision)
    for profile,decisions in profiles.items():
        # Kind/profile totals refer to recorded decisions, not all attempted work.
        key=f"{game.get('kind','unknown')}|{profile}"
        row=groups.setdefault(key,{'kind':game.get('kind','unknown'),'profile':profile,
            'games':0,'decisions':0,'gamesWithFallback':0,'fallbackDecisions':0,'reasons':{},'legacyDecisions':0})
        row['games']+=1;row['decisions']+=len(decisions)
        fallbacks=[d['fallback'] for d in decisions if d.get('fallback')]
        row['gamesWithFallback']+=bool(fallbacks);row['fallbackDecisions']+=len(fallbacks)
        row['legacyDecisions']+=sum('policyMask' not in d for d in decisions)
        for fallback in fallbacks:
            reason=fallback['reason'];row['reasons'][reason]=row['reasons'].get(reason,0)+1
        row['decisionRate']=row['fallbackDecisions']/row['decisions'] if row['decisions'] else 0
        row['gameRate']=row['gamesWithFallback']/row['games']
    return report


def observed_report(events):
    games={};unfinished={};completed={}
    for event in events:
        if event.get('type')=='decision-progress':
            game=games.setdefault(event['gameId'],{'kind':event['kind'],'decisions':{}})
            decision=event['decision'];previous=game['decisions'].get(decision['id'])
            if previous is not None and previous!=decision:raise ValueError('conflicting decision observation')
            game['decisions'][decision['id']]=decision
        elif event.get('type')=='game':completed[event['id']]=event['termination']
        elif event.get('type') in ('unfinished','unfinished-verification'):
            identity=event.get('id',event.get('job',{}).get('id'))
            unfinished[identity]=event.get('reason',event.get('result',{}).get('reason','unknown'))
    report={'coverage':'Observed decisions include unfinished games; absent interrupted work is not inferred.',
            'completedGames':len(completed),'unfinishedGames':len(unfinished),'unfinishedReasons':{}}
    for reason in unfinished.values():report['unfinishedReasons'][reason]=report['unfinishedReasons'].get(reason,0)+1
    for game in games.values():add_game(report,{**game,'decisions':list(game['decisions'].values())})
    return report


if __name__=='__main__':
    import argparse,json
    from pathlib import Path
    parser=argparse.ArgumentParser();parser.add_argument('run_directory',type=Path);args=parser.parse_args()
    print(json.dumps(observed_report(json.loads(line) for line in (args.run_directory/'runner-events.jsonl').open()),indent=2))
