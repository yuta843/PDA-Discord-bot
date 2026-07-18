"""Reduce an STL to a browser-friendly triangle count for the Activity client."""

from pathlib import Path
import argparse
import numpy as np
import trimesh


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--faces", type=int, default=40_000)
    args = parser.parse_args()

    mesh = trimesh.load_mesh(args.source, process=True)
    if not isinstance(mesh, trimesh.Trimesh):
        mesh = trimesh.util.concatenate(tuple(mesh.geometry.values()))
    print(f"input vertices={len(mesh.vertices)} faces={len(mesh.faces)}")
    simplified = mesh.simplify_quadric_decimation(face_count=args.faces)
    simplified.remove_unreferenced_vertices()
    if len(simplified.faces) > args.faces:
        raise RuntimeError(f"simplified mesh has {len(simplified.faces)} faces; expected at most {args.faces}")
    if simplified.is_empty or not np.isfinite(simplified.vertices).all():
        raise RuntimeError("simplified mesh has no finite vertex data")
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    simplified.export(args.destination)
    print(f"output vertices={len(simplified.vertices)} faces={len(simplified.faces)}")


if __name__ == "__main__":
    main()
