#!/usr/bin/env python3
"""Build the exhibition sculpture from a pinned, MIT-licensed author sample.

Requires Python 3 and NumPy. Downloads source data, never executes upstream code.
The original triangle topology receives two identical Loop subdivision passes
for the neutral surface and the 43 expression channels retained below. Sparse glTF accessors preserve
both position and normal deltas without bundling a texture or animation clip.
"""
import hashlib
import json
import math
import pathlib
import struct
import urllib.request
from collections import defaultdict

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / 'static' / 'models'
COMMIT = '86a89d247624e7b5e393e4336709e490db717382'
BASE = f'https://raw.githubusercontent.com/hizzlehoff/FaceCapCustomAvatarExporter/{COMMIT}/'
SOURCE_URL = BASE + 'Examples/Example.FCA'
LICENSE_URL = BASE + 'LICENSE'


def fetch(url):
    return urllib.request.urlopen(url, timeout=45).read()


def parse_fca(data):
    lines = data.decode('utf-8').splitlines()
    assert lines[0] == 'FaceCapAvatarVersion,0.1'
    meshes = []
    i = 2
    while i < len(lines):
        header = lines[i].split(',')
        assert header[0] == 'Object'
        mesh = {'name': header[1], 'offset': np.array(header[2:5], dtype=float), 'shapes': {}}
        i += 1
        for key in ('Vtx', 'Normals', 'Uvs', 'Faces'):
            h = lines[i].split(',')
            assert h[0] == key, (i, h)
            n = int(h[1]); i += 1
            chunk = lines[i:i+n]; i += n
            if key == 'Faces':
                mesh['faces'] = np.array([[int(x) for x in row.split(',')[0].split(':')] for row in chunk], dtype=np.uint32)
            else:
                mesh[key] = np.array([[float(x) for x in row.split(',')] for row in chunk], dtype=float)
        if i < len(lines) and lines[i].startswith('Shapes,'):
            n = int(lines[i].split(',')[1]); i += 1
            for _ in range(n):
                name = lines[i].split(',')[1]; i += 1
                count = len(mesh['Vtx'])
                mesh['shapes'][name] = np.array([[float(x) for x in row.split(',')] for row in lines[i:i+count]], dtype=float)
                i += count
        meshes.append(mesh)
    return meshes


def loop_subdivide(states, faces):
    """Apply the same linear subdivision operator to every facial state."""
    count = states.shape[1]
    adjacent = [set() for _ in range(count)]
    edge_faces = defaultdict(list)
    for a, b, c in faces.tolist():
        for x, y, other in ((a,b,c), (b,c,a), (c,a,b)):
            adjacent[x].add(y); adjacent[y].add(x)
            edge_faces[tuple(sorted((x,y)))].append(other)
    boundary = [set() for _ in range(count)]
    for (a,b), opposite in edge_faces.items():
        assert len(opposite) <= 2, 'Source must be manifold.'
        if len(opposite) == 1:
            boundary[a].add(b); boundary[b].add(a)
    out = np.empty((states.shape[0], count + len(edge_faces), 3), dtype=float)
    for idx, near in enumerate(adjacent):
        if len(boundary[idx]) == 2:
            neighbors = list(boundary[idx])
            out[:,idx] = .75*states[:,idx] + .125*states[:,neighbors].sum(axis=1)
        elif len(near):
            n = len(near)
            beta = (5/8 - (3/8 + .25*math.cos(2*math.pi/n))**2)/n
            out[:,idx] = (1-n*beta)*states[:,idx] + beta*states[:,list(near)].sum(axis=1)
        else:
            out[:,idx] = states[:,idx]
    edges = {}
    for offset, ((a,b), opposite) in enumerate(edge_faces.items()):
        idx = count+offset; edges[a,b] = idx
        out[:,idx] = (.375*(states[:,a]+states[:,b]) + .125*states[:,opposite].sum(axis=1)
                       if len(opposite)==2 else .5*(states[:,a]+states[:,b]))
    triangles=[]
    for a,b,c in faces.tolist():
        ab=edges[tuple(sorted((a,b)))]; bc=edges[tuple(sorted((b,c)))]; ca=edges[tuple(sorted((c,a)))]
        triangles.extend(((a,ab,ca),(ab,b,bc),(ca,bc,c),(ab,bc,ca)))
    return out, np.array(triangles,dtype=np.uint32)


def normals(vertices, faces):
    n = np.zeros_like(vertices)
    triangles = vertices[faces]
    face_normals = np.cross(triangles[:,1]-triangles[:,0], triangles[:,2]-triangles[:,0])
    for corner in range(3):
        np.add.at(n, faces[:,corner], face_normals)
    length = np.linalg.norm(n, axis=1)
    n /= np.maximum(length[:,None], 1e-15)
    return n


class GLB:
    def __init__(self):
        self.binary = bytearray()
        self.doc = {'asset': {'version':'2.0','generator':'emotion-exhibition build-sculpture-head.py',
                              'copyright':'Copyright (c) 2020 Niels J.; MIT. Subdivision and export by Emotion Exhibition.'},
                    'scene':0,'scenes':[{'nodes':[]}], 'nodes':[], 'meshes':[], 'materials':[],
                    'buffers':[{}], 'bufferViews':[], 'accessors':[]}

    def view(self, array):
        while len(self.binary)%4: self.binary.append(0)
        start=len(self.binary); raw=array.tobytes(); self.binary.extend(raw)
        idx=len(self.doc['bufferViews'])
        self.doc['bufferViews'].append({'buffer':0,'byteOffset':start,'byteLength':len(raw)})
        return idx

    def accessor(self, array, component=5126, bounds=False):
        array=np.ascontiguousarray(array,dtype={5126:'<f4',5123:'<u2',5125:'<u4'}[component])
        a={'bufferView':self.view(array),'componentType':component,'count':len(array),
           'type':'SCALAR' if array.ndim==1 else f'VEC{array.shape[1]}'}
        if bounds:
            a['min']=array.min(axis=0).tolist(); a['max']=array.max(axis=0).tolist()
        idx=len(self.doc['accessors']);self.doc['accessors'].append(a);return idx

    def sparse(self, delta, epsilon=1e-7):
        delta = np.asarray(delta,dtype='<f4')
        changed = np.where(np.max(np.abs(delta),axis=1) > epsilon)[0]
        # An empty morph still has a valid zero-valued accessor.
        a={'componentType':5126,'count':len(delta),'type':'VEC3',
           'min':delta.min(axis=0).tolist(),'max':delta.max(axis=0).tolist()}
        if len(changed):
            comp=5123 if len(delta)<65536 else 5125
            index_data=changed.astype('<u2' if comp==5123 else '<u4')
            a['sparse']={'count':len(changed),'indices':{'bufferView':self.view(index_data),'componentType':comp},
                         'values':{'bufferView':self.view(delta[changed])}}
        idx=len(self.doc['accessors']);self.doc['accessors'].append(a);return idx

    def save(self, path):
        while len(self.binary)%4:self.binary.append(0)
        self.doc['buffers'][0]['byteLength']=len(self.binary)
        encoded=json.dumps(self.doc,separators=(',',':')).encode()
        encoded+=b' '*((-len(encoded))%4)
        length=12+8+len(encoded)+8+len(self.binary)
        path.write_bytes(struct.pack('<III',0x46546c67,2,length)+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+
                         struct.pack('<II',len(self.binary),0x004e4942)+self.binary)


def main():
    DEST.mkdir(exist_ok=True,parents=True)
    source=fetch(SOURCE_URL); license_data=fetch(LICENSE_URL)
    objects=parse_fca(source)
    source_head=objects[0]['Vtx']
    center=np.array([(source_head[:,0].min()+source_head[:,0].max())/2,
                     (source_head[:,1].min()+source_head[:,1].max())/2, 1.4])
    scale=2.4/np.ptp(source_head[:,1])
    g=GLB()
    g.doc['materials']=[{'name':'Sculpture porcelain','pbrMetallicRoughness':{'baseColorFactor':[.72,.70,.65,1],
        'metallicFactor':.03,'roughnessFactor':.7}}, {'name':'Carved eyes','pbrMetallicRoughness':{
        'baseColorFactor':[.62,.61,.56,1],'metallicFactor':.02,'roughnessFactor':.55}}]
    info=[]
    for object_index, obj in enumerate(objects):
        names=[name for name in obj['shapes'] if not name.startswith('eyeLook')]
        states=np.array([obj['Vtx']]+[obj['shapes'][name] for name in names])
        states=(states + obj['offset'][None,None,:] - center[None,None,:])*scale
        faces=obj['faces']
        # FCA stores CCW triangles. Check source normals to catch accidental winding changes.
        source_normals=normals(obj['Vtx'],faces)
        assert np.mean(np.sum(source_normals*obj['Normals'],axis=1))>.5
        passes=2 if object_index==0 else 1
        for _ in range(passes):states,faces=loop_subdivide(states,faces)
        # Place the final mask exactly between -1.2 and +1.2 along Y.
        if object_index==0:
            refined_center=(states[0,:,1].min()+states[0,:,1].max())/2
            refined_scale=2.4/np.ptp(states[0,:,1])
        states[:,:,1]-=refined_center
        states*=refined_scale
        v=states[0]; n=normals(v,faces)
        positions=g.accessor(v,bounds=True); norm=g.accessor(n)
        uv=np.stack(((v[:,0]+1.05)/2.1,(v[:,1]+1.2)/2.4),axis=1)
        attrs={'POSITION':positions,'NORMAL':norm,'TEXCOORD_0':g.accessor(uv)}
        primitive={'attributes':attrs,'indices':g.accessor(faces.flatten(),5123 if len(v)<65536 else 5125),
                   'material':0 if object_index==0 else 1}
        mesh={'name':'SculptureHead' if object_index==0 else obj['name'],'primitives':[primitive]}
        if names:
            primitive['targets']=[]
            for shape in states[1:]:
                primitive['targets'].append({'POSITION':g.sparse(shape-v),'NORMAL':g.sparse(normals(shape,faces)-n, epsilon=1e-5)})
            mesh['weights']=[0]*len(names);mesh['extras']={'targetNames':names}
        node_index=len(g.doc['nodes']);mesh_index=len(g.doc['meshes'])
        g.doc['meshes'].append(mesh);g.doc['nodes'].append({'name':mesh['name'],'mesh':mesh_index})
        g.doc['scenes'][0]['nodes'].append(node_index)
        info.append({'name':mesh['name'],'vertices':len(v),'triangles':len(faces),'morphs':len(names),
                     'bounds':{'min':v.min(axis=0).tolist(),'max':v.max(axis=0).tolist()}})
        if object_index==0:
            head=v; head_names=names
    def calibrated(p):
        p=(np.array(p)-center)*scale;p[1]-=refined_center;return p*refined_scale
    # Projection anchors are surface landmarks, rather than eye sphere centers in depth.
    source_landmarks={'left_eye':[-2.8,2.5095,3.65], 'right_eye':[2.8,2.4723,3.65],
                      'nose':[.0327,-.6267,7.4648], 'mouth':[.026,-3.81,5.40]}
    landmark3d={key:calibrated(p).tolist() for key,p in source_landmarks.items()}
    # Original vertices survive Loop refinement at the same index. These seeds
    # identify the two lip sheets and their cheek junctions, not image guesses.
    # Vertex 24 barely moves under jawOpen; 25 is the opposing lower inner lip.
    # The mouth interior is closed by mesh faces, so it has no boundary loop.
    mouth_vertices={'mouth_left':394, 'mouth_right':824,
                    'mouth_upper_inner':24, 'mouth_lower_inner':25,
                    'mouth_upper_outer':21, 'mouth_lower_outer':28}
    landmark3d.update({key:head[index].tolist() for key,index in mouth_vertices.items()})
    landmark3d['mouth']=((head[24]+head[25])/2).tolist()
    landmark_indices={key:int(np.argmin(np.linalg.norm(head-np.array(p),axis=1))) for key,p in landmark3d.items()}
    landmark_indices.update(mouth_vertices)
    metadata={'name':'Collective Sculpture','source':SOURCE_URL,'sourceCommit':COMMIT,
              'sourceSha256':hashlib.sha256(source).hexdigest(),'license':'MIT','author':'Niels J. / Face Cap',
              'authorPage':'https://www.bannaflak.com/face-cap/importavatar.html',
              'coordinates':'+Y up; +Z front; x<0 is viewer left; mask occupies y=-1.2..1.2',
              'construction':'Original open face mask with two Loop subdivision passes; 43 expressions (eight unused eyeLook channels omitted); sparse position and normal deltas; separate subdivided eyes; textures omitted.',
              'bounds':{'left':float(head[:,0].min()),'right':float(head[:,0].max()),'top':1.2,'bottom':-1.2},
              'landmarks':{k:v[:2] for k,v in landmark3d.items()}, 'landmarks3d':landmark3d,
              'landmarkVertexIndices':landmark_indices,
              'mouthLandmarkMethod':'Refined coordinates of source vertices: lip-to-cheek junctions 394/824, upper/lower inner lip sheets 24/25, upper/lower outer lip crests 21/28. Mouth center is the midpoint of 24 and 25. The source has a closed mouth interior, not a boundary hole.',
              'meshes':info, 'morphNames':head_names, 'sourceMorphCount':51, 'omittedMorphs':[name for name in objects[0]['shapes'] if name.startswith('eyeLook')]}
    g.doc['scenes'][0]['extras']={'portrait':metadata,**{k:metadata[k] for k in ('bounds','landmarks','landmarks3d','landmarkVertexIndices')}}
    g.doc['asset']['extras']={'portrait':metadata}
    path=DEST/'sculpture-head.glb';g.save(path)
    metadata['glbBytes']=path.stat().st_size;metadata['glbSha256']=hashlib.sha256(path.read_bytes()).hexdigest()
    (DEST/'sculpture-head.metadata.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
    (DEST/'sculpture-head-LICENSE.txt').write_bytes(license_data)
    print(json.dumps(metadata,indent=2))


if __name__=='__main__':main()
