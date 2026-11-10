import json,sys,statistics,pathlib
folder=pathlib.Path(sys.argv[1]); rows=[json.loads(s) for s in (folder/'runs.jsonl').read_text().splitlines()];events=[]
for s in (folder/'services.log').read_text().splitlines():
 try: e=json.loads(s)
 except ValueError: continue
 if e.get('msg') in ['archive_stage','archive_claim','archive_publication']:events.append(e)
(folder/'observations.jsonl').write_text(''.join(json.dumps(e,ensure_ascii=False)+'\n' for e in events))
summary=[]
for article in dict.fromkeys(r['article'] for r in rows):
 ids={r.get('cardId') for r in rows if r['article']==article};v={}
 for stage in ['queue','html','extraction','media','publication','attempt']:
  vals=[]
  for e in events:
   if e.get('link_id') not in ids:continue
   if stage=='queue' and e['msg']=='archive_claim':vals.append(e['queue_age_seconds']*1000)
   elif stage=='publication' and e['msg']=='archive_publication':vals.append(e['duration_ms'])
   elif e['msg']=='archive_stage' and e.get('stage')==stage:vals.append(e['duration_ms'])
  if len(vals)!=len(ids):raise ValueError((article,stage,len(vals),len(ids)))
  vals.sort();v[stage]={'count':len(vals),'min_ms':min(vals),'median_ms':statistics.median(vals),'p90_ms':vals[(9*len(vals)+9)//10-1],'max_ms':max(vals)}
 summary.append({'article':article,'stages':v})
(folder/'stages.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
