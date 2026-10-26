# Rerun: create and activate C:/Abhinav/Projects/_scratch/reaper/venv; pip install cadquery-ocp==7.9.3.1.1 numpy mapbox-earcut
# With that venv active: python tools/reaper/convert.py [--inspect]; node tools/reaper/pack.mjs
# Render the compressed GLB: node tools/reaper/render.mjs; dependencies and scratch stay outside the checkout.
"""Tessellate the owner's named R5G STEP assembly without changing placements."""
import argparse
import hashlib
import json
import re
import struct
import urllib.request
from pathlib import Path

import numpy as np
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Surface, BRepAdaptor_Curve2d
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.BRepTools import BRepTools, BRepTools_WireExplorer
from OCP.ShapeFix import ShapeFix_Face
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label, TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.TopLoc import TopLoc_Location
from OCP.TopAbs import TopAbs_FACE, TopAbs_WIRE, TopAbs_REVERSED
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Pnt, gp_Vec
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ShapeTool

ROOT = Path(__file__).resolve().parents[2]
SCRATCH = Path('C:/Abhinav/Projects/_scratch/reaper')
SOURCE = SCRATCH / 'Reaper_R5_Assembly.step'
REVISION = 'febf878892c55c2b860df741a00ce0af51c1f41d'
ROTATE = np.array([[-1., 0., 0.], [0., 0., 1.], [0., 1., 0.]])
WOOD = {'A04', 'A13', 'A16', 'A18', 'A25', 'A26', 'A34', 'A43', 'A47', 'A48', 'A54',
        'A01_R', 'A01_L', 'A05_R', 'A05_L', 'A10_R', 'A10_L', 'A24_R', 'A24_L',
        'A35_R', 'A35_L', 'A44_R', 'A44_L', 'A53_R', 'A53_L', 'A62_F', 'A62_A',
        'A62_DL', 'A62_DR', 'A07_R_I', 'A07_R_O', 'A07_R_D1', 'A07_R_D2',
        'A07_L_I', 'A07_L_O', 'A07_L_D1', 'A07_L_D2'}
PRINTED = {'A06', 'A11', 'A12', 'A21', 'A23', 'A36', 'A45', 'A55',
           'HWR', 'HWL', 'HTR', 'HTL', 'HTRB', 'HTLB'}
NAMES = {
    'A04':'rear_body_former', 'A13':'front_horizontal_frame', 'A16':'middle_body_former',
    'A18':'tail_bulkhead', 'A25':'front_gear_crossmember', 'A26':'motor_firewall',
    'A34':'front_body_former', 'A43':'aft_horizontal_frame', 'A47':'gear_crossplate',
    'A48':'aft_gear_crossmember', 'A54':'centre_body_former',
    'A06':'centre_fairing', 'A08':'forward_upper_cover', 'A12':'tail_carrier',
    'A15':'aft_upper_cover', 'A17':'lower_body_wrap', 'A20':'tail_underside',
    'A42':'aft_lower_body', 'A56':'forward_lower_body', 'A59':'nose_upper_cover',
    'A11':'aileron_L', 'A21':'aileron_R', 'A23':'hinge_rail_L', 'A36':'hinge_rail_R',
    'A27':'outer_wing_skin_L', 'A38':'outer_wing_skin_R',
    'A49':'inner_wing_skin_R', 'A52':'inner_wing_skin_L',
    'A45':'wing_root_R', 'A55':'wing_root_L',
    'A22':'fixed_V_tail_L', 'A57':'fixed_V_tail_R', 'A41':'ruddervator_R', 'A60':'ruddervator_L',
    'HWR':'aileron_horn_R', 'HWL':'aileron_horn_L', 'HTR':'tail_horn_R', 'HTL':'tail_horn_L',
    'HTRB':'tail_horn_backing_R', 'HTLB':'tail_horn_backing_L',
    'CF_FRONT':'front_carbon_rod', 'CF_REAR':'rear_carbon_rod',
}
for stem, desc in {'A01':'rear_rod_rib', 'A05':'front_wing_spar', 'A10':'aileron_outer_endplate',
                   'A24':'middle_wing_rib', 'A35':'inner_wing_rib', 'A44':'reinforced_outer_rib',
                   'A53':'aileron_inner_endplate'}.items():
    for side in ('L', 'R'):
        NAMES[f'{stem}_{side}'] = f'{desc}_{side}'
for side in ('L', 'R'):
    for suffix, desc in {'I':'inboard', 'O':'outboard', 'D1':'lap_1', 'D2':'lap_2'}.items():
        NAMES[f'A07_{side}_{suffix}'] = f'rear_spar_{desc}_{side}'
NAMES.update({'A62_F':'front_keel', 'A62_A':'aft_keel', 'A62_DL':'keel_lap_L', 'A62_DR':'keel_lap_R'})
REPAIRED_FACES = []
UV_REMESHES = []


def remesh_uv(face, name):
    """Triangulate actual STEP trim curves when OCCT's mesher rejects a face.

    All vertices and normals still evaluate the original parametric surface.
    Bound chord error to 0.04 mm and check area against the CAD integral.
    """
    import mapbox_earcut
    surface = BRepAdaptor_Surface(face, True)

    def point(uv):
        p = surface.Value(float(uv[0]), float(uv[1]))
        return np.array([p.X(),p.Y(),p.Z()])

    def sample(curve, a, b, depth=0):
        u, v, m = curve.Value(a), curve.Value(b), curve.Value((a+b)/2)
        ua, ub, um = np.array([u.X(),u.Y()]), np.array([v.X(),v.Y()]), np.array([m.X(),m.Y()])
        error = np.linalg.norm(point(um) - (point(ua)+point(ub))/2)
        if error > .02:
            if depth >= 16:
                raise RuntimeError('Trim curve subdivision limit reached')
            return sample(curve,a,(a+b)/2,depth+1) + sample(curve,(a+b)/2,b,depth+1)
        return [ua]

    outer = BRepTools.OuterWire_s(face)
    wires = [outer]
    explorer = TopExp_Explorer(face, TopAbs_WIRE)
    while explorer.More():
        wire = TopoDS.Wire_s(explorer.Current())
        if not wire.IsSame(outer):
            wires.append(wire)
        explorer.Next()
    coordinates, ends = [], []
    for wire in wires:
        ring = []
        explorer = BRepTools_WireExplorer(wire, face)
        while explorer.More():
            edge = explorer.Current()
            curve = BRepAdaptor_Curve2d(edge, face)
            a, b = curve.FirstParameter(), curve.LastParameter()
            if edge.Orientation() == TopAbs_REVERSED:
                a, b = b, a
            ring.extend(sample(curve,a,b))
            explorer.Next()
        clean = []
        for uv in ring:
            if not clean or np.linalg.norm(point(uv)-point(clean[-1])) > 1e-7:
                clean.append(uv)
        if len(clean)>2 and np.linalg.norm(point(clean[0])-point(clean[-1])) < 1e-7:
            clean.pop()
        if len(clean) < 3:
            raise RuntimeError('Degenerate trim ring')
        coordinates.extend(clean)
        ends.append(len(coordinates))
    uv = np.array(coordinates)
    triangles = mapbox_earcut.triangulate_float64(uv,np.array(ends,dtype=np.uint32)).reshape(-1,3)
    max_error = 0
    for level in range(9):
        p = np.array([point(q) for q in uv])
        max_error = max(np.linalg.norm(point(uv[t].mean(axis=0))-p[t].mean(axis=0)) for t in triangles)
        for a,b in ((0,1),(1,2),(2,0)):
            max_error = max(max_error,max(np.linalg.norm(point((uv[t[a]]+uv[t[b]])/2)-(p[t[a]]+p[t[b]])/2) for t in triangles))
        if max_error <= .04:
            break
        if level == 8 or len(triangles)>50000:
            raise RuntimeError('Surface subdivision limit reached')
        vertices = uv.tolist()
        midpoints = {}

        def midpoint(a,b):
            key = tuple(sorted((int(a),int(b))))
            if key not in midpoints:
                midpoints[key] = len(vertices)
                vertices.append(((uv[a]+uv[b])/2).tolist())
            return midpoints[key]

        refined = []
        for a,b,c in triangles:
            ab,bc,ca = midpoint(a,b),midpoint(b,c),midpoint(c,a)
            refined.extend([[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]])
        uv, triangles = np.array(vertices),np.array(refined)
    normals = []
    for u,v in uv:
        origin,du,dv = gp_Pnt(),gp_Vec(),gp_Vec()
        surface.D1(float(u),float(v),origin,du,dv)
        n = du.Crossed(dv)
        n.Normalize()
        if face.Orientation() == TopAbs_REVERSED:
            n.Reverse()
        normals.append([n.X(),n.Y(),n.Z()])
    normals = np.array(normals)
    cross = np.cross(p[triangles[:,1]]-p[triangles[:,0]],p[triangles[:,2]]-p[triangles[:,0]])
    reverse = np.einsum('ij,ij->i',cross,normals[triangles[:,0]]) < 0
    triangles[reverse] = triangles[reverse][:,[0,2,1]]
    area = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face,area)
    mesh_area = float(np.linalg.norm(cross,axis=1).sum()/2)
    relative_error = abs(mesh_area-area.Mass())/area.Mass()
    if relative_error > .002:
        raise RuntimeError(f'UV remesh area mismatch: CAD {area.Mass()}, mesh {mesh_area}')
    UV_REMESHES.append({'part':name,'cad_area_mm2':area.Mass(),'mesh_area_mm2':mesh_area,
                       'relative_area_error':relative_error,'max_chord_error_mm':float(max_error)})
    print('Trim-curve remesh',UV_REMESHES[-1],flush=True)
    return p,normals,triangles


def group_for(name):
    if name.startswith('CF_'):
        return 'carbon_spars'
    if name in {'A22', 'A60', 'HTL', 'HTLB'}:
        return 'tail_L'
    if name in {'A57', 'A41', 'HTR', 'HTRB'}:
        return 'tail_R'
    if name in {'A11', 'A23', 'A27', 'A52', 'A55', 'HWL'} or re.match(r'A(01|05|07|10|24|35|44|53)_L', name):
        return 'wing_L'
    if name in {'A21', 'A36', 'A38', 'A49', 'A45', 'HWR'} or re.match(r'A(01|05|07|10|24|35|44|53)_R', name):
        return 'wing_R'
    return 'motor_mount' if name == 'A26' else 'fuselage'


def tessellate(shape, name):
    # Absolute 0.08 mm chord tolerance, 4.6 degree angular tolerance. Surface
    # normals come from the STEP surface derivatives, not triangle face normals.
    mesh = BRepMesh_IncrementalMesh(shape, .08, False, .08, True)
    if not mesh.IsDone():
        raise RuntimeError('STEP tessellation failed')
    positions, normals, indices = [], [], []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        face = TopoDS.Face_s(explorer.Current())
        location = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, location)
        if tri is None or tri.NbTriangles() == 0:
            BRepTools.Clean_s(face)
            BRepMesh_IncrementalMesh(face, .02, False, .04, False)
            tri = BRep_Tool.Triangulation_s(face, location)
        if tri is None or tri.NbTriangles() == 0:
            fixer = ShapeFix_Face(face)
            fixer.SetPrecision(1e-6)
            fixer.Perform()
            face = fixer.Face()
            BRepMesh_IncrementalMesh(face, .02, False, .04, False)
            tri = BRep_Tool.Triangulation_s(face, location)
            REPAIRED_FACES.append(name)
        if tri is None or tri.NbTriangles() == 0:
            p,n,t = remesh_uv(face,name)
            offset = len(positions)
            positions.extend(p.tolist())
            normals.extend(n.tolist())
            indices.extend((t+offset).tolist())
            explorer.Next()
            continue
        offset = len(positions)
        surface = BRepAdaptor_Surface(face, True)
        reverse = face.Orientation() == TopAbs_REVERSED
        local_positions, local_normals = [], []
        for i in range(1, tri.NbNodes() + 1):
            p = tri.Node(i).Transformed(location.Transformation())
            local_positions.append([p.X(), p.Y(), p.Z()])
            uv = tri.UVNode(i)
            point, du, dv = gp_Pnt(), gp_Vec(), gp_Vec()
            surface.D1(uv.X(), uv.Y(), point, du, dv)
            n = du.Crossed(dv)
            if n.SquareMagnitude() > 1e-20:
                n.Normalize()
                if reverse:
                    n.Reverse()
                local_normals.append([n.X(), n.Y(), n.Z()])
            else:
                local_normals.append([0., 0., 0.])
        face_indices = []
        for i in range(1, tri.NbTriangles() + 1):
            t = tri.Triangle(i)
            a, b, c = [t.Value(j) - 1 for j in (1, 2, 3)]
            if reverse:
                b, c = c, b
            face_indices.append([a, b, c])
        p = np.array(local_positions)
        n = np.array(local_normals)
        t = np.array(face_indices)
        missing = np.linalg.norm(n, axis=1) < .5
        if missing.any():
            fallback = np.zeros_like(n)
            cross = np.cross(p[t[:, 1]] - p[t[:, 0]], p[t[:, 2]] - p[t[:, 0]])
            for corner in range(3):
                np.add.at(fallback, t[:, corner], cross)
            lengths = np.linalg.norm(fallback, axis=1)
            if np.any(missing & (lengths < 1e-15)):
                raise RuntimeError('Unresolved surface normal')
            n[missing] = fallback[missing] / lengths[missing, None]
        positions.extend(p.tolist())
        normals.extend(n.tolist())
        indices.extend((t + offset).tolist())
        explorer.Next()
    return (np.array(positions) @ ROTATE.T / 1000., np.array(normals) @ ROTATE.T,
            np.array(indices, dtype='<u4').ravel())


def write_glb(parts):
    geometry = []
    for name, shape, _ in parts:
        print('Tessellating', name, flush=True)
        p, n, t = tessellate(shape, name)
        geometry.append((name, p, n, t))
    all_min = np.min([p.min(axis=0) for _, p, _, _ in geometry], axis=0)
    all_max = np.max([p.max(axis=0) for _, p, _, _ in geometry], axis=0)
    centre = (all_min + all_max) / 2
    # Colour values are linear PBR values, chosen to read as unpainted light foam,
    # pale plywood, satin printed polymer, and dark carbon under a studio key.
    materials = [
        {'name':'light_foam_skin', 'pbrMetallicRoughness':{'baseColorFactor':[.73,.75,.74,1], 'metallicFactor':0, 'roughnessFactor':.63}},
        {'name':'pale_plywood_structure', 'pbrMetallicRoughness':{'baseColorFactor':[.37,.26,.15,1], 'metallicFactor':0, 'roughnessFactor':.77}},
        {'name':'printed_polymer', 'pbrMetallicRoughness':{'baseColorFactor':[.48,.51,.52,1], 'metallicFactor':0, 'roughnessFactor':.48}},
        {'name':'carbon_rods', 'pbrMetallicRoughness':{'baseColorFactor':[.018,.023,.027,1], 'metallicFactor':.15, 'roughnessFactor':.36}},
    ]
    data = {'asset':{'version':'2.0', 'generator':'Reaper STEP conversion', 'extras':{
        'source':f'https://github.com/mcarkade/Reaper/blob/{REVISION}/CAD/Reaper_R5_Assembly.step',
        'source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'units':'metres', 'up':'+Y', 'nose':'-Z',
        'source_transform':'target=(-source.X, source.Z, source.Y)/1000; bbox-centred',
        'side_names':'L/R retain the original CAD side identities',
        'chord_tolerance_mm':.08, 'angular_tolerance_radians':.08,
        'parts_dropped':[], 'source_absences':['N1 printed nose reference','motor','propeller','landing gear','electronics'],
        'face_parameter_repair_attempts':REPAIRED_FACES,
        'trim_curve_remeshes':UV_REMESHES,
    }}, 'scene':0, 'scenes':[{'name':'Reaper', 'nodes':[0]}],
        'nodes':[{'name':'Reaper_R5G', 'children':[]}], 'meshes':[], 'materials':materials,
        'buffers':[{'byteLength':0}], 'bufferViews':[], 'accessors':[]}
    binary = bytearray()

    def accessor(array, kind, component):
        array = np.ascontiguousarray(array)
        while len(binary) % 4:
            binary.append(0)
        view = len(data['bufferViews'])
        data['bufferViews'].append({'buffer':0, 'byteOffset':len(binary), 'byteLength':array.nbytes})
        binary.extend(array.tobytes())
        a = {'bufferView':view, 'componentType':component, 'count':len(array), 'type':kind}
        if kind == 'VEC3':
            a.update(min=array.min(axis=0).tolist(), max=array.max(axis=0).tolist())
        data['accessors'].append(a)
        return len(data['accessors']) - 1

    groups = {}
    for group in dict.fromkeys(group_for(name) for name, _, _, _ in geometry):
        members = [p for name, p, _, _ in geometry if group_for(name) == group]
        pivot = (np.min([p.min(axis=0) for p in members],axis=0) + np.max([p.max(axis=0) for p in members],axis=0))/2
        index = len(data['nodes'])
        data['nodes'].append({'name':group, 'translation':(pivot-centre).tolist(), 'children':[]})
        data['nodes'][0]['children'].append(index)
        groups[group] = (index, pivot)
    for name, p, n, t in geometry:
        group_index, group_pivot = groups[group_for(name)]
        pivot = (p.min(axis=0) + p.max(axis=0))/2
        material = 3 if name.startswith('CF_') else 1 if name in WOOD else 2 if name in PRINTED else 0
        label = f'{name}_{NAMES[name]}'
        mesh_index = len(data['meshes'])
        data['meshes'].append({'name':label, 'primitives':[{'attributes':{
            'POSITION':accessor((p-pivot).astype('<f4'),'VEC3',5126),
            'NORMAL':accessor(n.astype('<f4'),'VEC3',5126)},
            'indices':accessor(t,'SCALAR',5125), 'material':material}]})
        index = len(data['nodes'])
        data['nodes'].append({'name':label, 'mesh':mesh_index, 'translation':(pivot-group_pivot).tolist(),
                              'extras':{'cad_id':name}})
        data['nodes'][group_index]['children'].append(index)
    while len(binary) % 4:
        binary.append(0)
    data['buffers'][0]['byteLength'] = len(binary)
    encoded = json.dumps(data,separators=(',',':')).encode()
    encoded += b' ' * ((-len(encoded)) % 4)
    glb = struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))
    glb += struct.pack('<II',len(encoded),0x4e4f534a)+encoded
    glb += struct.pack('<II',len(binary),0x004e4942)+binary
    (SCRATCH / 'reaper-raw.glb').write_bytes(glb)
    print(json.dumps({'parts':len(parts), 'triangles':sum(len(t)//3 for _,_,_,t in geometry),
                      'bounds_metres':[(all_min-centre).tolist(),(all_max-centre).tolist()],
                      'bytes':len(glb)}), flush=True)


def bounds(shape):
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    lo, hi = box.CornerMin(), box.CornerMax()
    return np.array([[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]])


def label_name(label):
    attr = TDataStd_Name()
    return attr.Get().ToExtString() if label.FindAttribute(TDataStd_Name.GetID_s(), attr) else ''


def read_parts():
    doc = TDocStd_Document(TCollection_ExtendedString('Reaper'))
    reader = STEPCAFControl_Reader()
    reader.SetNameMode(True)
    if int(reader.ReadFile(str(SOURCE))) != 1 or not reader.Transfer(doc):
        raise RuntimeError('STEP import failed')
    tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    roots = TDF_LabelSequence()
    tool.GetFreeShapes(roots)
    parts = []

    def walk(label, parent, path):
        reference = TDF_Label()
        name = label_name(label)
        loc = parent.Multiplied(XCAFDoc_ShapeTool.GetLocation_s(label))
        if XCAFDoc_ShapeTool.GetReferredShape_s(label, reference):
            label = reference
            name = label_name(label) or name
        children = TDF_LabelSequence()
        if XCAFDoc_ShapeTool.GetComponents_s(label, children):
            for i in range(1, children.Length() + 1):
                walk(children.Value(i), loc, path + [name])
        else:
            shape = XCAFDoc_ShapeTool.GetShape_s(label).Located(loc)
            parts.append((name, shape, path))

    for i in range(1, roots.Length() + 1):
        walk(roots.Value(i), TopLoc_Location(), [])
    return doc, parts


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--inspect', action='store_true')
    options = args.parse_args()
    SCRATCH.mkdir(parents=True, exist_ok=True)
    if not SOURCE.exists():
        url = f'https://raw.githubusercontent.com/mcarkade/Reaper/{REVISION}/CAD/Reaper_R5_Assembly.step'
        with urllib.request.urlopen(url, timeout=180) as response:
            SOURCE.write_bytes(response.read())
    doc, parts = read_parts()
    if len(parts) != 68 or len({name for name,_,_ in parts}) != 68:
        raise RuntimeError('The source must contain exactly 68 distinct R5G CAD identities')
    summary = [{'name': name, 'bounds_mm': bounds(shape).round(3).tolist(), 'path': path}
               for name, shape, path in parts]
    (SCRATCH / 'parts.json').write_text(json.dumps(summary, indent=2))
    if options.inspect:
        for item in summary:
            print(item['name'], item['bounds_mm'], flush=True)
        return
    write_glb(parts)


if __name__ == '__main__':
    main()
