'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..');
function load(source){const box={module:{exports:{}},require:createRequire(path.join(root,'engine.js')),console};vm.createContext(box);vm.runInContext(source+'\nglobalThis.inspectReview={attackOptions,normalizeMap};',box);return {engine:box.module.exports,internals:box.inspectReview};}
const old=load(fs.readFileSync('/tmp/review-base-engine.js','utf8'));
const currentSource=fs.readFileSync(path.join(root,'engine.js'),'utf8');
const current=load(currentSource);
const structural=load(currentSource.replace('.filter(id => attackOptions(state, context, id).length > 0)', '.filter(id => ownedRegions(state,id).some(source => context.adjacency[source.id].some(targetId => { const target=state.regions[targetId]; return target.owner!==id && combatRouteAllowed(state,context,id,source,target) && !coalitionPartner(state,id,target.owner); })))'));
const regions=[];for(let y=0;y<5;y++)for(let x=0;x<10;x++){const id=y*10+x,neighbors=[];if(x>0)neighbors.push(id-1);if(x<9)neighbors.push(id+1);if(y>0)neighbors.push(id-10);if(y<4)neighbors.push(id+10);regions.push({id,name:'r'+id,x,y,neighbors,terrain:id%11===0?'mountain':id%7===0?'river':'plain',fertility:.8+(id*7%6)*.1});}
const map={width:10,height:5,regions};
const core=s=>JSON.stringify({rng:s.rngState,regions:s.regions,factions:Object.fromEntries(Object.entries(s.factions).map(([id,{resourceLedger,...f}])=>[id,f])),phase:s.phase,campaignPhase:s.campaignPhase});
const a=old.engine.createGame(map,'replay-seed',{autoWar:true}),b=current.engine.createGame(map,'replay-seed',{autoWar:true}),c=structural.engine.createGame(map,'replay-seed',{autoWar:true});
let firstDifference=null;
for(let month=1;month<=700;month++){
  for(const [loaded,state] of [[old,a],[current,b],[structural,c]])if(!state.finished)loaded.engine.step(state,map);
  if(firstDifference===null&&core(a)!==core(b)){firstDifference=month;console.log('FIRST DIFFERENCE',month,'old',a.options,'new',b.options);}
  if([419,420,450,500,600,700].includes(month)){
    for(const [name,loaded,state] of [['baseline',old,a],['revised',current,b],['structural-front',structural,c]]){
      const rows=loaded.engine.ranking(state,map).filter(r=>r.alive).map(r=>({id:r.id,land:r.territories,troops:r.troops,fronts:loaded.internals.attackOptions(state,loaded.internals.normalizeMap(map),r.id).length}));
      console.log(JSON.stringify({name,at:month,actual:state.month,finished:state.finished,rows}));
    }
  }
}
