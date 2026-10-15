// PersonnelFile.jsx — one crew member's file, opened from the CREW screen
// (click a name, or `file <name>`). Everything shown is read from their
// profile (universe/personnel/profile.js) — the timeline tab is the raw
// history every other tab is built from.
import { useState } from "react";
import { useUI } from "./store.js";
import { career } from "./engine.js";
import { DEPARTMENTS } from "../universe/crew.js";
import {
  fullName, ageOn, biography, skillLevel, levelName, skillById, dutyById, activityById, awardById,
  CORE_SKILL, qualifiedDepts, activityTrains, PRONOUNS,
} from "../universe/personnel/profile.js";
import { LEVEL_XP } from "../universe/personnel/data/skills.js";
import { dateOf, yearsBetween, SHIFT_LABEL, SHIFT_HOURS } from "../universe/personnel/util.js";

const TABS = ["Overview", "Skills", "Duties", "Service", "Family", "Medical", "Timeline"];
const MARITAL = { single: "Single", married: "Married", partnered: "Partnered", divorced: "Divorced", widowed: "Widowed" };
const CADENCE = { shift: "Every shift", daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

function Row({ k, v }) {
  return <div className="pf-row"><span className="pf-k">{k}</span><span className="pf-v">{v}</span></div>;
}

// `gained`: practice this mission, not yet written into the file.
function SkillBar({ id, xp: filed, gained = 0, core }) {
  const xp = filed + gained;
  const lv = skillLevel({ skills: { [id]: { xp } } }, id);
  const next = LEVEL_XP[lv + 1];
  const into = next ? (xp - LEVEL_XP[lv]) / (next - LEVEL_XP[lv]) : 1;
  return (
    <div className={`pf-skill ${core ? "core" : ""}`}>
      <span className="pf-skill-name">
        {skillById[id]?.label ?? id}{core ? " ★" : ""}
        {gained >= 0.5 && <span className="pf-gain" title="Practice this mission"> +{Math.round(gained)}</span>}
      </span>
      <span className="pf-pips">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`pf-pip ${i <= lv ? "on" : i === lv + 1 ? "part" : ""}`}
            style={i === lv + 1 ? { "--fill": `${into * 100}%` } : undefined} />
        ))}
      </span>
      <span className="pf-skill-lv">{levelName(lv)}</span>
    </div>
  );
}

export default function PersonnelFile({ id, member }) {
  const [tab, setTab] = useState("Overview");
  const runOrder = useUI((s) => s.runOrder);
  const p = career.profiles[id];
  if (!p) return null;
  const today = career.day;
  const close = () => useUI.getState().setPersonnel(null);
  const pr = PRONOUNS[p.identity.pronouns];
  const dept = member?.dept ?? p.post.assignedDept ?? p.post.dept;
  const dead = p.status.state === "deceased" || member?.status === "dead";
  const core = CORE_SKILL[p.post.dept];
  const gained = member?.xp ?? {};
  const skillIds = [...new Set([...Object.keys(p.skills), ...Object.keys(gained)])];
  const xpOf = (k) => (p.skills[k]?.xp ?? 0) + (gained[k] ?? 0);
  const skills = skillIds.sort((a, b) => (b === core) - (a === core) || xpOf(b) - xpOf(a));
  const crossSkill = p.post.crossTrain;
  const [from, to] = SHIFT_HOURS[p.post.shift] ?? [8, 16];
  const canGo = qualifiedDepts(p).filter((d) => d !== dept);

  return (
    <div className="pf-overlay" onClick={close}>
      <div className="pf-card" onClick={(e) => e.stopPropagation()}>
        <div className="pf-head">
          <div>
            <div className="pf-name">{p.post.rank} {fullName(p)}</div>
            <div className="pf-sub">
              {p.post.role} · {DEPARTMENTS[p.post.dept].label}
              {dept !== p.post.dept && <span className="pf-reassigned"> · working in {DEPARTMENTS[dept].label}</span>}
              {" · "}{pr.sub}/{pr.obj} · {p.id}
            </div>
          </div>
          <div className="pf-head-right">
            {dead
              ? <span className="pf-status dead">DECEASED</span>
              : member && <span className={`pf-status ${member.status}`}>{member.status.toUpperCase()} {Math.round(member.health * 100)}%</span>}
            <button className="pf-close" onClick={close}>CLOSE</button>
          </div>
        </div>
        <div className="pf-tabs">
          {TABS.map((t) => <button key={t} className={`pf-tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>{t.toUpperCase()}</button>)}
        </div>
        <div className="pf-body">
          {tab === "Overview" && (
            <>
              <p className="pf-bio">{biography(p, today)}</p>
              <div className="pf-grid">
                <Row k="Age" v={`${ageOn(p, dead ? p.status.day : today)}`} />
                <Row k="Born" v={`${dateOf(p.identity.birthDay)}, ${p.identity.birthplace}`} />
                <Row k="In the fleet since" v={`${dateOf(p.joinedFleetDay)} (${yearsBetween(p.joinedFleetDay, today)} yrs)`} />
                <Row k="Aboard since" v={dateOf(p.joinedShipDay)} />
                <Row k="Missions" v={p.stats.missions} />
                <Row k="Primary duty" v={dutyById[p.duties[0]]?.label ?? "—"} />
                <Row k="Watch" v={`${SHIFT_LABEL[p.post.shift] ?? "—"} (${String(from).padStart(2, "0")}00–${String(to % 24).padStart(2, "0")}00)${member && !dead
                  ? ` · ${member.location === "station" ? "on duty" : member.location === "quarters" ? "off watch" : member.location}, ${Math.round((1 - member.fatigue) * 100)}% rested` : ""}`} />
                <Row k="Core skill" v={`${skillById[core].label} — ${levelName(skillLevel(p, core))}`} />
                <Row k="Decorations" v={p.awards.length ? p.awards.length : "None"} />
              </div>
              {!dead && member && (
                <div className="pf-actions">
                  <span className="pf-k">Reassign:</span>
                  {dept !== p.post.dept && <button className="crew-btn" onClick={() => runOrder?.(`reassign ${fullName(p)} back`)}>BACK TO {DEPARTMENTS[p.post.dept].label.toUpperCase()}</button>}
                  {canGo.filter((d) => d !== p.post.dept).map((d) => (
                    <button key={d} className="crew-btn" onClick={() => runOrder?.(`reassign ${fullName(p)} to ${d}`)}>{DEPARTMENTS[d].label.toUpperCase()}</button>
                  ))}
                  {!canGo.filter((d) => d !== p.post.dept).length && dept === p.post.dept && <span className="pf-muted">No cross-training — can't cover another department yet</span>}
                </div>
              )}
            </>
          )}

          {tab === "Skills" && (
            <div className="pf-skills">
              {skills.map((sid) => <SkillBar key={sid} id={sid} xp={p.skills[sid]?.xp ?? 0} gained={gained[sid] ?? 0} core={sid === core} />)}
              <div className="pf-muted">★ core skill for {DEPARTMENTS[p.post.dept].label}. Qualified (2+) in a department's core skill means they can be reassigned there. +N is practice this mission — it goes on file when the mission ends.</div>
              {!dead && (
                <div className="pf-actions">
                  <span className="pf-k">Cross-train{crossSkill ? ` (now: ${skillById[crossSkill]?.label})` : ""}:</span>
                  {Object.keys(CORE_SKILL).filter((d) => d !== p.post.dept && CORE_SKILL[d] !== crossSkill).map((d) => (
                    <button key={d} className="crew-btn small" onClick={() => runOrder?.(`cross-train ${fullName(p)} in ${d}`)}
                      title={`${skillById[CORE_SKILL[d]].label}: ${levelName(skillLevel(p, CORE_SKILL[d]))}`}>
                      {DEPARTMENTS[d].label.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "Duties" && (
            <>
              <div className="pf-section">CORE RESPONSIBILITIES</div>
              {p.duties.map((d, i) => (
                <div key={d} className="pf-item">
                  <span className="pf-item-title">{dutyById[d]?.label ?? d}{i === 0 ? " (primary)" : ""}</span>
                  <span className="pf-item-text">{dutyById[d]?.description}</span>
                </div>
              ))}
              <div className="pf-section">REGULAR ACTIVITIES</div>
              <table className="pf-table">
                <thead><tr><th>Activity</th><th>When</th><th>Hours</th><th>Trains</th></tr></thead>
                <tbody>
                  {p.schedule.map((s) => {
                    const a = s.activity.startsWith("duty:") ? { label: `Watch: ${dutyById[s.activity.slice(5)]?.label}` } : activityById[s.activity];
                    const trains = activityTrains(p, s.activity).map((t) => skillById[t.skill]?.label).filter(Boolean).join(", ");
                    return (
                      <tr key={s.activity}>
                        <td>{a?.label ?? s.activity}</td><td>{CADENCE[s.cadence]}</td><td>{s.hours}</td><td className="pf-muted">{trains || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {tab === "Service" && (
            <>
              <div className="pf-section">POSTINGS</div>
              {p.serviceRecord.slice().reverse().map((s, i) => (
                <div key={i} className="pf-item">
                  <span className="pf-item-title">{s.ship}</span>
                  <span className="pf-item-text">{s.role} · {dateOf(s.fromDay)} – {s.toDay != null ? dateOf(s.toDay) : dead ? dateOf(p.status.day) : "present"}</span>
                </div>
              ))}
              <div className="pf-section">EDUCATION</div>
              {p.education.map((e, i) => (
                <div key={i} className="pf-item">
                  <span className="pf-item-title">{e.degree}, {e.field}</span>
                  <span className="pf-item-text">{e.institution} · {dateOf(e.day)}</span>
                </div>
              ))}
              <div className="pf-section">DECORATIONS</div>
              {p.awards.length ? p.awards.slice().sort((a, b) => (awardById[b.id]?.rank ?? 0) - (awardById[a.id]?.rank ?? 0)).map((a, i) => (
                <div key={i} className="pf-item">
                  <span className="pf-item-title pf-award">{awardById[a.id]?.label ?? a.id}</span>
                  <span className="pf-item-text">{a.citation} · {dateOf(a.day)}</span>
                </div>
              )) : <div className="pf-muted">None</div>}
            </>
          )}

          {tab === "Family" && (
            <div className="pf-grid">
              <Row k="Marital status" v={MARITAL[p.family.maritalStatus]} />
              {p.family.spouse && <Row k={p.family.maritalStatus === "partnered" ? "Partner" : "Spouse"}
                v={`${p.family.spouse.name} — ${p.family.spouse.occupation}${p.family.spouse.status === "deceased" ? " (deceased)" : ""}`} />}
              <Row k="Children" v={p.family.children.length
                ? p.family.children.map((c) => `${c.name} (${yearsBetween(c.birthDay, today)})`).join(", ") : "None"} />
              <Row k="Family residence" v={p.family.residence} />
              <Row k="Next of kin" v={p.family.nextOfKin} />
            </div>
          )}

          {tab === "Medical" && (
            <div className="pf-grid">
              <Row k="Blood type" v={p.medical.bloodType} />
              <Row k="Height / mass" v={`${p.medical.heightCm} cm / ${p.medical.massKg} kg`} />
              <Row k="Fitness" v={`${Math.round(p.medical.fitness * 100)}%`} />
              <Row k="Allergies" v={p.medical.allergies.length ? p.medical.allergies.join(", ") : "None known"} />
              <Row k="Conditions" v={p.medical.conditions.length ? p.medical.conditions.join(", ") : "None"} />
              <Row k="Lifetime dose" v={`${(p.medical.lifetimeDoseSv + (member?.dose ?? 0)).toFixed(2)} Sv${member?.dose > 0.005 ? ` (incl. ${member.dose.toFixed(2)} this mission)` : ""}`} />
              <Row k="Last physical" v={dateOf(p.medical.lastPhysicalDay)} />
              <Row k="Injury history" v={p.medical.injuries.length ? p.medical.injuries.map((x) => `${x.text} (${dateOf(x.day)})`).join("; ") : "None"} />
              {dead && <Row k="Cause of death" v={p.status.cause} />}
            </div>
          )}

          {tab === "Timeline" && (
            <div className="pf-timeline">
              {p.timeline.slice().reverse().map((e, i) => (
                <div key={i} className={`pf-event t-${e.type}`}>
                  <span className="pf-event-date">{dateOf(e.day)}</span>
                  <span className="pf-event-text">{e.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
