import { useEffect, useState } from 'react';
import { aanwezigheidApi, type RollenRechten as Raster } from '../services/aanwezigheidApi';
import { foutTekst, Link, Melding } from './ui';

/**
 * Rechten per rol (/dashboard/medewerkers/rechten, enkel platformbeheer). Enkel de rechten die een module instelbaar
 * maakt; de platformbeheerder heeft altijd alles. Welk evenement of welke sessie iemand ziet, blijft apart geregeld
 * (koppeling aan een evenement, of voor een sessiegever aan een sessie).
 */
export function RollenRechten() {
  const [raster, setRaster] = useState<Raster | null>(null);
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState('');

  useEffect(() => {
    aanwezigheidApi.rollenRechten().then(setRaster).catch((e) => setFout(foutTekst(e)));
  }, []);

  const zet = async (rol: string, recht: string, toegestaan: boolean) => {
    setBezig(`${rol} ${recht}`);
    setFout('');
    try {
      setRaster(await aanwezigheidApi.zetRecht(rol, recht, toegestaan));
    } catch (e) {
      setFout(foutTekst(e));
    }
    setBezig('');
  };

  return (
    <>
      <p className="d-kruimel"><Link href="/dashboard/medewerkers">Medewerkers</Link> › Rollen en rechten</p>
      <header className="d-paginakop">
        <div>
          <h1>Rollen en rechten</h1>
          <p className="d-sub">Wat elke rol mag. Een platformbeheerder mag altijd alles. Welke evenementen iemand ziet, kies je bij de medewerker.</p>
        </div>
      </header>
      {fout && <Melding soort="fout">{fout}</Melding>}
      {!raster ? (
        !fout && <p>Even geduld…</p>
      ) : (
        <div className="d-tabelvak">
          <table className="d-tabel">
            <thead>
              <tr>
                <th>Recht</th>
                {raster.rollen.map((r) => <th key={r.rol} className="rr-rol">{r.naam}</th>)}
              </tr>
            </thead>
            <tbody>
              {raster.rechten.map((r) => (
                <tr key={r.recht}>
                  <td>{r.omschrijving}<div className="d-klein">{r.module}</div></td>
                  {raster.rollen.map(({ rol, naam }) => {
                    const v = r.per[rol];
                    return (
                      <td key={rol} className="rr-rol">
                        <label className="rr-vak">
                          <input type="checkbox" checked={v.toegestaan} disabled={bezig === `${rol} ${r.recht}`} aria-label={`${naam}: ${r.omschrijving}`}
                            onChange={(e) => zet(rol, r.recht, e.target.checked)} />
                          {v.toegestaan !== v.standaard && <span className="rr-aangepast">aangepast</span>}
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
