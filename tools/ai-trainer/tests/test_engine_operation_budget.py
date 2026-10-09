import json
import subprocess
import unittest
from righelt_training.config import ROOT

class EngineOperationBudgetTest(unittest.TestCase):
    def test_replay_and_internal_generation_work_are_separate_from_bounded_search_nodes(self):
        script="""
import {createEngineOperationBudget,EngineExpansionLimit,REPLAY_MAX_EXPANSIONS} from './tools/ai-trainer/engine-operation-budget.mjs';
import {checkEngineComputation} from './packages/game-engine/src/index.ts';
import {experimentConfig} from './packages/computer-player/src/index.ts';
const rows=[];
for(const command of ['replay','generate']){
 const budget=createEngineOperationBudget(command,experimentConfig.search.maxNodes,()=>{});
 let completed=budget.bounded(()=>{for(let i=0;i<2049;i++)checkEngineComputation(true);return true;});
 let limited=false;try{budget.bounded(()=>{for(let i=0;i<=REPLAY_MAX_EXPANSIONS;i++)checkEngineComputation(true);});}
 catch(error){if(!(error instanceof EngineExpansionLimit))throw error;limited=true;}
 const expired=new Error('deadline');let deadline=false;
 try{createEngineOperationBudget(command,2048,()=>{throw expired;}).bounded(()=>true);}
 catch(error){deadline=error===expired;}
 rows.push({command,completed,limited,deadline,...budget.stats});
}
console.log(JSON.stringify(rows));
"""
        rows=json.loads(subprocess.check_output(['node','--import','tsx','--input-type=module','-e',script],cwd=ROOT,text=True,timeout=10))
        for row in rows:
            self.assertTrue(row['completed']);self.assertTrue(row['limited']);self.assertTrue(row['deadline'])
            self.assertEqual(row['searchNodesLimit'],2048)
            self.assertEqual(row['perOperationLimit'],16384);self.assertEqual(row['peakExpansions'],16384)

if __name__=='__main__':unittest.main()
