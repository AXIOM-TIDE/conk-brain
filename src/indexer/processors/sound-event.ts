import { pool } from '../../db/pool.js';
import type { SourceEvent } from '../source-provider.js';

const KNOWN_VESSELS = [
  { vessel_id: '0x8b801ce16d09a505820efe35e12037cde52226c5ba6667bb5bfce4dd30420765', agent_id: 'spark', agent_name: 'S.P.A.R.K.' },
  { vessel_id: '0x6e0481e37532546db0c266e5db92f136ce9257cf49fa243aa060352916df03e6', agent_id: 'neural', agent_name: 'N.E.U.R.A.L.' },
  { vessel_id: '0xee61dbc7fd5b6f231952a243e53daf91ad7afce7e0518c65acb1e543012a3dd9', agent_id: 'crypto', agent_name: 'C.R.Y.P.T.O.' },
  { vessel_id: '0xfc094d623d7e26e435d6413477f06f450c13d1b8bda16b45bba2093085f997b1', agent_id: 'aristo', agent_name: 'A.R.I.S.T.O.' },
  { vessel_id: '0x52bf2dff2a4e067566def4192e60895057e1a21e85fe0684f5971f8c4b7c3862', agent_id: 'web', agent_name: 'W.E.B.' },
  { vessel_id: '0x83f2a3a446ceb66047d3e6e713087d3288854ebab24c8525fca31c8fa5ccf2ef', agent_id: 'franklin', agent_name: 'FRANKLIN' },
];

export async function processSoundEvent(event: SourceEvent): Promise<void> {
  const { payload, timestamp } = event;
  const castId = payload.cast_id as string || payload.object_id as string;
  const vesselId = payload.vessel_id as string;
  if (!castId || !vesselId) return;
  const feeUsdc = payload.fee_paid ? Number(payload.fee_paid as string) / 1_000_000 : 0;
  const known = KNOWN_VESSELS.find(v => v.vessel_id === vesselId);
  await pool.query(`
    INSERT INTO casts (cast_id, vessel_id, author_address, fee_usdc, is_paid, sound_tx, sounded_at)
    VALUES ($1,$2,'unknown',$3,$4,$5,$6)
    ON CONFLICT (cast_id) DO UPDATE SET vessel_id=EXCLUDED.vessel_id, sound_tx=COALESCE(casts.sound_tx,EXCLUDED.sound_tx), sounded_at=COALESCE(casts.sounded_at,EXCLUDED.sounded_at), updated_at=NOW()
  `, [castId, vesselId, feeUsdc, feeUsdc > 0, payload._txDigest as string, timestamp]);
  await pool.query(`
    INSERT INTO vessels (vessel_id, owner_address, agent_id, agent_name, cast_count, first_sound_at, last_sound_at)
    VALUES ($1,'unknown',$2,$3,1,$4,$4)
    ON CONFLICT (vessel_id) DO UPDATE SET cast_count=vessels.cast_count+1, last_sound_at=EXCLUDED.last_sound_at, updated_at=NOW()
  `, [vesselId, known?.agent_id||null, known?.agent_name||null, timestamp]);
  console.log(`[brain][sound] ${castId.slice(0,12)} | ${known?.agent_name||vesselId.slice(0,8)}`);
}
