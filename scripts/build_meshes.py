"""Build GLB meshes for the basal ganglia - thalamo-cortical motor loop.

Source: Allen Human Reference Atlas (Ding et al. 2016, doi:10.1002/cne.24080),
served by BrainGlobe as `allen_human_500um`. Surfaces are extracted from the
annotation volume with marching cubes, split per hemisphere, smoothed and
decimated, then written to public/meshes/ together with manifest.json.

Atlas orientation is "asr" (axis0 anterior->posterior, axis1 superior->inferior,
axis2 right->left). Output space is three.js-friendly RAS-like millimetres:
x = right, y = superior, z = anterior, centred on the whole-brain centroid.

Usage:  python scripts/build_meshes.py
"""

import json
import sys
from pathlib import Path

import fast_simplification
import numpy as np
import trimesh
from brainglobe_atlasapi import BrainGlobeAtlas
from scipy import ndimage
from skimage import measure

OUT = Path(__file__).resolve().parent.parent / "public" / "meshes"
VOXEL_MM = 0.5
PMC_DEPTH_VOX = 40  # premotor strip: 20 mm anterior to the precentral gyrus

# id, label, group, colour, atlas acronyms (union), target triangles per hemisphere
STRUCTURES = [
    ("brain", "Whole brain", "shell", "#c9d3e6", ["root"], 70000),
    ("m1", "Primary motor cortex (M1, precentral gyrus)", "cortex", "#ff7a59", ["PrCG"], 14000),
    ("pmc", "Premotor cortex (BA6, approx. caudal SFG/MFG)", "cortex", "#ffb347", ["PMC"], 12000),
    ("caudate", "Caudate nucleus", "context", "#8aa0b8", ["Ca"], 3000),
    ("putamen", "Putamen", "striatum", "#4fc3f7", ["Pu"], 5000),
    ("gpe", "Globus pallidus, external segment (GPe)", "pallidum", "#7e8cff", ["GPe"], 3000),
    ("gpi", "Globus pallidus, internal segment (GPi)", "pallidum", "#b388ff", ["GPi"], 2500),
    ("stn", "Subthalamic nucleus (STN)", "stn", "#ffd54f", ["STH"], 1500),
    ("sn", "Substantia nigra", "nigra", "#e17bd6", ["SN"], 2000),
    ("thalamus", "Thalamus", "context", "#9fb7a7", ["THM"], 5000),
    ("va", "Ventral anterior nucleus of thalamus (VA)", "thalamus", "#66e0a3", ["VA"], 2500),
    ("vl", "Ventral lateral nucleus of thalamus (VL; pallidal input reaches its oral part, VLo)", "thalamus", "#2ecc71", ["VL"], 3000),
    # attention + executive windows
    ("vis", "Visual cortex (occipital lobe)", "cortex", "#5ad1c8", ["OccL"], 12000),
    ("spl", "Superior parietal lobule / intraparietal sulcus", "cortex", "#26a69a", ["SPL"], 10000),
    ("tpj", "Temporo-parietal junction (approx. supramarginal + angular gyri)", "cortex", "#80cbc4", ["SMG", "AnG"], 10000),
    ("fef", "Frontal eye field (approx. caudal MFG, BA6/8)", "cortex", "#4db6ac", ["FEF"], 5000),
    ("dlpfc", "Dorsolateral prefrontal cortex (BA9/46, MFG rostral to BA6)", "cortex", "#9575cd", ["DLPFC"], 10000),
    ("acc", "Anterior cingulate cortex", "cortex", "#ba68c8", ["CgGr"], 8000),
    ("pul", "Pulvinar", "thalamus", "#4dd0e1", ["Pul"], 2500),
    ("md", "Mediodorsal nucleus of thalamus", "thalamus", "#7986cb", ["MD"], 2500),
    ("sc", "Superior colliculus", "brainstem", "#00bfa5", ["SC"], 1500),
    ("lc", "Locus coeruleus (approx.: dorsal rostral pontine tegmentum; not in atlas)", "brainstem", "#ff5c8a", ["LC"], 800),
]

# Gaussian smoothing (voxels) applied to binary masks before marching cubes
SIGMA = {"shell": 1.2, "cortex": 1.0}
SIGMA_DEFAULT = 0.8


def descendant_ids(atlas, acronym):
    sid = atlas.structures[acronym]["id"]
    return [s["id"] for s in atlas.structures_list if sid in s["structure_id_path"]]


def premotor_mask(atlas, ann):
    """Caudal SFG + MFG within PMC_DEPTH_VOX anterior to the precentral gyrus.

    Done per (superior-inferior row, hemisphere): the anterior edge of PrCG in
    that row bounds the strip, approximating Brodmann area 6 (lateral PMd/PMv
    and the medial SMA on the SFG).
    """
    prcg = np.isin(ann, descendant_ids(atlas, "PrCG"))
    frontal = np.isin(ann, descendant_ids(atlas, "SFG") + descendant_ids(atlas, "MFG"))
    mask = np.zeros_like(frontal)
    a_idx = np.arange(ann.shape[0])[:, None]
    for row in range(ann.shape[1]):
        p = prcg[:, row, :]
        if not p.any():
            continue
        # anterior-most PrCG voxel per lateral column; propagate across columns
        has = p.any(axis=0)
        front = np.where(has, p.argmax(axis=0), -1)
        cols = np.where(has)[0]
        # fill gaps across columns by nearest PrCG column (SFG medially lacks PrCG)
        nearest = cols[np.abs(np.arange(ann.shape[2])[:, None] - cols[None, :]).argmin(axis=1)]
        front = front[nearest]
        strip = (a_idx >= front[None, :] - PMC_DEPTH_VOX) & (a_idx < front[None, :] + 4)
        mask[:, row, :] = frontal[:, row, :] & strip
    return mask


def lc_mask(atlas, ann):
    """LC is not in the atlas: dorsal quarter of the rostral half of the pontine tegmentum."""
    m = np.isin(ann, descendant_ids(atlas, "PnTg"))
    idx = np.argwhere(m)
    a0, a1 = idx[:, 0].min(), idx[:, 0].max()
    s0, s1 = idx[:, 1].min(), idx[:, 1].max()
    out = np.zeros_like(m)
    out[a0:(a0 + a1) // 2 + 1, s0:s0 + (s1 - s0) // 4 + 1, :] = True
    return m & out


def to_world(verts_vox, center_vox):
    v = (verts_vox - center_vox) * VOXEL_MM
    # asr -> (x=R, y=S, z=A): x=-axis2, y=-axis1, z=-axis0  (proper rotation)
    return np.stack([-v[:, 2], -v[:, 1], -v[:, 0]], axis=1)


def surface(mask, sigma, center_vox, target_tris):
    idx = np.argwhere(mask)
    lo = np.maximum(idx.min(0) - 4, 0)
    hi = np.minimum(idx.max(0) + 5, mask.shape)
    crop = mask[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]].astype(np.float32)
    crop = np.pad(crop, 2)
    field = ndimage.gaussian_filter(crop, sigma)
    verts, faces, _, _ = measure.marching_cubes(field, level=0.5)
    verts = verts + lo - 2
    mesh = trimesh.Trimesh(to_world(verts, center_vox), faces, process=True)
    if len(mesh.faces) > target_tris:
        v, f = fast_simplification.simplify(
            mesh.vertices.astype(np.float32), mesh.faces.astype(np.int32),
            target_reduction=1 - target_tris / len(mesh.faces))
        mesh = trimesh.Trimesh(v, f, process=True)
    trimesh.smoothing.filter_taubin(mesh, iterations=8)
    mesh.fix_normals()
    return mesh


def main():
    atlas = BrainGlobeAtlas("allen_human_500um", check_latest=False)
    ann = atlas.annotation
    print("annotation", ann.shape, "orientation", atlas.orientation)

    brain = ann > 0
    center_vox = np.argwhere(brain).mean(0)
    mid = ann.shape[2] / 2  # axis2: right (low) -> left (high)
    hemis = {"R": np.arange(ann.shape[2]) < mid, "L": np.arange(ann.shape[2]) >= mid}

    pmc = premotor_mask(atlas, ann)
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"source": atlas.metadata["citation"], "units": "mm",
                "axes": "x=right, y=superior, z=anterior", "structures": []}

    missing = []
    for sid, label, group, color, acrs, tris in STRUCTURES:
        if acrs == ["root"]:
            mask = brain
        elif acrs == ["PMC"]:
            mask = pmc
        elif acrs == ["FEF"]:
            mask = pmc & np.isin(ann, descendant_ids(atlas, "MFG"))
        elif acrs == ["DLPFC"]:
            mask = np.isin(ann, descendant_ids(atlas, "MFG")) & ~pmc
        elif acrs == ["LC"]:
            mask = lc_mask(atlas, ann)
        else:
            ids = []
            for acr in acrs:
                if acr not in atlas.structures.acronym_to_id_map:
                    missing.append(acr)
                    continue
                ids += descendant_ids(atlas, acr)
            mask = np.isin(ann, ids)
        if group == "context" and sid == "thalamus":
            # keep VA/VL visible: thalamus shell without the two motor nuclei
            mask = mask & ~np.isin(ann, descendant_ids(atlas, "VA") + descendant_ids(atlas, "VL")
                                     + descendant_ids(atlas, "Pul") + descendant_ids(atlas, "MD"))
        for h, cols in hemis.items():
            m = mask & cols[None, None, :]
            if m.sum() < 20:
                print(f"  ! {sid}_{h}: empty")
                missing.append(f"{sid}_{h}")
                continue
            mesh = surface(m, SIGMA.get(group, SIGMA_DEFAULT), center_vox, tris)
            name = f"{sid}_{h}"
            mesh.export(OUT / f"{name}.glb")
            c = mesh.vertices.mean(0)
            manifest["structures"].append({
                "id": name, "base": sid, "label": label, "group": group, "color": color,
                "hemisphere": h, "centroid": [round(float(x), 2) for x in c],
                "bbox": [[round(float(x), 2) for x in mesh.bounds[0]],
                         [round(float(x), 2) for x in mesh.bounds[1]]],
                "voxels": int(m.sum()), "triangles": int(len(mesh.faces)),
            })
            print(f"  {name:12s} vox={int(m.sum()):8d} tris={len(mesh.faces):6d} centroid={np.round(c, 1)}")

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    if missing:
        print("MISSING structures:", missing)
        sys.exit(1)
    total = sum(p.stat().st_size for p in OUT.glob("*.glb"))
    print(f"wrote {len(manifest['structures'])} meshes, {total / 1e6:.1f} MB -> {OUT}")


if __name__ == "__main__":
    main()
