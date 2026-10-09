// starShader.js — animated stellar surface + corona for BodyMesh stars.
//
// Surface: domain-warped 3D simplex fBm sampled on the sphere's object-space
// position, so the plasma churns in place (and turns with the body's slow
// spin) instead of scrolling like a texture. Layered on top: fine
// granulation cells, slow-drifting sunspots, and limb darkening (the edge of
// a real star is dimmer and redder — you're looking through cooler gas).
//
// Corona: an additive back-faced shell around the star. Brightness is driven
// by how close each view ray passes to the star's centre (not by the shell's
// own normals), so the glow hugs the visible limb and still works when the
// camera is inside the shell. Noise around the limb breaks it into streamers.
import * as THREE from "three";

// How far the corona reaches, in star radii.
export const CORONA_EXTENT = 2.6;

// Ashima Arts / Stefan Gustavson 3D simplex noise (MIT).
const SIMPLEX = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){
  float a=0.5,s=0.0;
  for(int i=0;i<5;i++){s+=a*snoise(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=0.5;}
  return s;
}
// Coarser 3-octave fBm for features that must stay crisp at a distance.
float fbm3(vec3 p){
  float a=0.5,s=0.0;
  for(int i=0;i<3;i++){s+=a*snoise(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=0.5;}
  return s;
}
`;

const surfaceVertex = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vNormalV;
varying vec3 vViewPos;
void main(){
  vObjPos = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

const surfaceFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform vec3 uSeed;
varying vec3 vObjPos;
varying vec3 vNormalV;
varying vec3 vViewPos;
${SIMPLEX}
void main(){
  vec3 p = vObjPos * 1.5 + uSeed;
  float t = uTime * 0.06;

  // Domain warp: offset the lookup by another noise field, twice, so the
  // pattern folds and flows like convecting liquid rather than blobs.
  vec3 q = vec3(fbm3(p + vec3(0.0, t, 0.0)), fbm3(p + vec3(5.2, 1.3 - t, 2.8)), fbm3(p + vec3(t, 2.1, 7.7)));
  vec3 r = vec3(fbm3(p + 2.0*q + vec3(1.7, 9.2, t*1.3)), fbm3(p + 2.0*q + vec3(8.3, 2.8, -t)), 0.0);
  float plasma = fbm(p + 2.2*r.xyx);                  // ~[-1,1]

  // Filaments: ridged noise along the warped flow — thin bright threads of
  // plasma riding the convection, the "liquid fire" streaks.
  float ridge = 1.0 - abs(1.6 * fbm3(p * 1.2 + 2.5*r.yxy + vec3(0.0, 0.0, t*2.0)));
  ridge = pow(clamp(ridge, 0.0, 1.0), 6.0);

  // Granulation: boiling cells with darker lanes. Faded out as the cells
  // shrink toward pixel size, or a distant star just turns to static.
  vec3 gp = vObjPos * 8.0 + uSeed;
  float gran = pow(1.0 - abs(snoise(gp + vec3(0.0, uTime*0.2, 0.0))), 2.0);
  gran *= 1.0 - smoothstep(0.15, 0.6, length(fwidth(gp)));

  // Sunspots: few, slow, with a near-black umbra inside a softer penumbra.
  float spotN = snoise(vObjPos * 1.6 + uSeed.zxy + vec3(uTime*0.01));
  float spot = smoothstep(0.84, 0.93, spotN);
  float penumbra = smoothstep(0.76, 0.84, spotN) - spot;

  // fBm rarely strays far from 0, so stretch it to use the whole ramp.
  float pl = clamp(plasma * 1.8, -1.0, 1.0);
  float heat = clamp(0.48 + 0.38*pl + 0.45*ridge + 0.12*(gran - 0.5), 0.0, 1.0);
  heat *= 1.0 - 0.85*spot - 0.35*penumbra;

  // Colour ramp from the star's own colour: deep and saturated in the cool
  // lanes (shifted warm — even a pale star's plasma glows orange where it's
  // coolest), the base colour mid-way, near-white where it's hottest.
  vec3 cool = pow(uColor, vec3(4.0)) * vec3(1.0, 0.6, 0.4) * 0.55;
  vec3 hot  = mix(uColor, vec3(1.0), 0.6) * 1.25;
  vec3 col = heat < 0.55 ? mix(cool, uColor * 0.9, heat / 0.55) : mix(uColor * 0.9, hot, (heat - 0.55) / 0.45);

  // Limb darkening: dimmer and deeper-coloured toward the edge.
  float mu = clamp(dot(normalize(vNormalV), normalize(-vViewPos)), 0.0, 1.0);
  col *= 0.45 + 0.55 * pow(mu, 0.5);
  col = mix(col * cool / max(uColor, vec3(0.05)) * 1.8, col, smoothstep(0.0, 0.45, mu));

  // Not tone-mapped (see makeStarMaterials): ACES desaturates bright colour
  // toward white, which flattened pale stars into a cream disc.
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const coronaVertex = /* glsl */ `
varying vec3 vWorldPos;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const coronaFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uRadius;   // star's world radius
uniform float uExtent;   // corona reaches out to uRadius * uExtent
uniform vec3 uCenter;    // star centre, world space
uniform vec3 uSeed;
varying vec3 vWorldPos;
${SIMPLEX}
void main(){
  vec3 ray = normalize(vWorldPos - cameraPosition);
  vec3 toC = uCenter - cameraPosition;
  float along = dot(toC, ray);
  vec3 closest = cameraPosition + ray * along;
  float d = length(closest - uCenter) / uRadius;   // 1.0 = grazing the limb
  if (d < 1.0 && along > 0.0) discard;             // ray hits the star itself
  float x = clamp((d - 1.0) / (uExtent - 1.0), 0.0, 1.0);

  // Streamers: noise on the direction from the centre to the ray's closest
  // point, so they radiate out from the limb and slowly writhe.
  vec3 dir = normalize(closest - uCenter);
  float n = fbm(dir * 3.0 + uSeed + vec3(0.0, 0.0, uTime*0.05));
  float n2 = snoise(dir * 9.0 + uSeed + vec3(uTime*0.15));
  float streak = 0.65 + 0.45*n + 0.15*n2;

  float glow = exp(-x * 5.5) * (1.0 - x) * streak;
  float inner = exp(-x * 22.0) * 0.8;               // bright thin rim right at the edge
  vec3 col = mix(uColor, vec3(1.0), 0.35) * (glow + inner);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Stable per-star seed so neighbouring stars don't share a surface pattern.
function seedFor(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  const f = (k) => (((h >>> k) & 1023) / 1023) * 100;
  return new THREE.Vector3(f(0), f(10), f(20));
}

export function makeStarMaterials(obj) {
  const color = new THREE.Color(obj.color || "#ffffff");
  const seed = seedFor(obj.id);
  const surface = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uTime: { value: 0 }, uSeed: { value: seed } },
    vertexShader: surfaceVertex,
    fragmentShader: surfaceFragment,
    toneMapped: false,
  });
  const corona = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color }, uTime: { value: 0 }, uSeed: { value: seed },
      uRadius: { value: obj.size || 1 }, uExtent: { value: CORONA_EXTENT },
      uCenter: { value: new THREE.Vector3() },
    },
    vertexShader: coronaVertex,
    fragmentShader: coronaFragment,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return { surface, corona };
}
