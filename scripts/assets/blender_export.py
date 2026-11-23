import argparse
import json
import math
import os
import sys


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    parser = argparse.ArgumentParser(description="Export normalized GLB for Asteroids P1 assets")
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--target-radius", default=None)
    parser.add_argument("--forward", default=None)
    parser.add_argument("--node-filter", default=None)
    parser.add_argument("--id", default=None)
    parser.add_argument("--yaw-deg", type=float, default=0.0)
    parser.add_argument("--pitch-deg", type=float, default=0.0)
    parser.add_argument("--roll-deg", type=float, default=0.0)
    parser.add_argument("--rotation-deg", default=None, help="pitch,yaw,roll degrees")
    return parser.parse_args(argv)


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False))


def fail(reason, **extra):
    payload = {"status": "failed", "reason": reason}
    payload.update(extra)
    emit(payload)
    raise SystemExit(1)


def manual(reason, **extra):
    payload = {"status": "manual", "reason": reason}
    payload.update(extra)
    emit(payload)
    raise SystemExit(0)


def clean_scene(bpy):
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_source(bpy, source):
    ext = os.path.splitext(source)[1].lower()
    if ext == ".blend":
        bpy.ops.wm.open_mainfile(filepath=source)
        return
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=source)
        return
    if ext == ".obj":
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=source)
        else:
            bpy.ops.import_scene.obj(filepath=source)
        return
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=source)
        return
    manual(f"Unsupported source format: {ext}", source=source)


def mesh_objects(scene):
    return [obj for obj in scene.objects if obj.type == "MESH"]


def select_export_objects(bpy, node_filter):
    meshes = mesh_objects(bpy.context.scene)
    if not meshes:
        manual("No mesh objects found after import")

    selected = meshes
    if node_filter:
        nf = node_filter.lower()
        selected = [obj for obj in meshes if nf in obj.name.lower()]
        if not selected:
            manual(f"nodeFilter '{node_filter}' matched no mesh objects", nodeFilter=node_filter,
                   available=[obj.name for obj in meshes])

    # If filter is ambiguous (matches many top-level unrelated objects), report manual.
    # Heuristic: allow multiple meshes if they share a common prefix/parent chain; otherwise manual.
    if node_filter and len(selected) > 12:
        manual(
            f"nodeFilter '{node_filter}' matched {len(selected)} mesh objects; ambiguous selection",
            nodeFilter=node_filter,
            matches=[obj.name for obj in selected[:30]],
        )

    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.context.scene.objects:
        obj.hide_set(False)
        obj.hide_select = False
    for obj in selected:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = selected[0]
    return selected


def root_objects(objects):
    selected = set(objects)
    return [obj for obj in objects if obj.parent not in selected]


def apply_transforms(bpy, objects):
    roots = root_objects(objects)
    targets = roots if roots else objects
    bpy.ops.object.select_all(action="DESELECT")
    for obj in targets:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def world_bounds(objects, depsgraph):
    import mathutils

    min_v = mathutils.Vector((math.inf, math.inf, math.inf))
    max_v = mathutils.Vector((-math.inf, -math.inf, -math.inf))
    found = False
    for obj in objects:
        eval_obj = obj.evaluated_get(depsgraph)
        try:
            mesh = eval_obj.to_mesh(preserve_all_data_layers=False, depsgraph=depsgraph)
        except Exception:
            mesh = None
        if mesh is None:
            for corner in obj.bound_box:
                w = obj.matrix_world @ mathutils.Vector(corner)
                min_v.x = min(min_v.x, w.x); min_v.y = min(min_v.y, w.y); min_v.z = min(min_v.z, w.z)
                max_v.x = max(max_v.x, w.x); max_v.y = max(max_v.y, w.y); max_v.z = max(max_v.z, w.z)
                found = True
            continue
        try:
            for v in mesh.vertices:
                w = eval_obj.matrix_world @ v.co
                min_v.x = min(min_v.x, w.x); min_v.y = min(min_v.y, w.y); min_v.z = min(min_v.z, w.z)
                max_v.x = max(max_v.x, w.x); max_v.y = max(max_v.y, w.y); max_v.z = max(max_v.z, w.z)
                found = True
        finally:
            eval_obj.to_mesh_clear()
    if not found:
        manual("Could not compute bounds for selected objects")
    return min_v, max_v


def recenter_to_bounds_center(bpy, objects):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    min_v, max_v = world_bounds(objects, depsgraph)
    center = (min_v + max_v) / 2.0
    for obj in root_objects(objects):
        obj.location -= center
    bpy.context.view_layer.update()
    return center


def parse_target_radius(value, asset_id=None):
    if value is None or value == "":
        return None
    try:
        radius = float(value)
    except Exception:
        manual("Invalid targetRadius; expected a number", id=asset_id, targetRadius=value)
    if not math.isfinite(radius) or radius <= 0:
        manual("Invalid targetRadius; expected a positive finite number", id=asset_id, targetRadius=value)
    return radius


def parse_rotation_deg(args):
    if args.rotation_deg:
        parts = [p.strip() for p in str(args.rotation_deg).split(",")]
        if len(parts) != 3:
            manual("Invalid rotationDeg; expected pitch,yaw,roll", rotationDeg=args.rotation_deg)
        try:
            pitch, yaw, roll = [float(p) for p in parts]
        except Exception:
            manual("Invalid rotationDeg; expected numeric pitch,yaw,roll", rotationDeg=args.rotation_deg)
        return pitch, yaw, roll
    return args.pitch_deg, args.yaw_deg, args.roll_deg


def normalize_scale_to_radius(bpy, objects, target_radius, asset_id=None):
    if target_radius is None:
        manual("targetRadius is required for normalization/export", id=asset_id)
    if not math.isfinite(target_radius) or target_radius <= 0:
        manual("Invalid targetRadius; expected a positive finite number", id=asset_id, targetRadius=target_radius)
    import mathutils

    depsgraph = bpy.context.evaluated_depsgraph_get()
    min_v, max_v = world_bounds(objects, depsgraph)
    center = (min_v + max_v) / 2.0
    # bounding sphere radius from center
    radius = 0.0
    for obj in objects:
        eval_obj = obj.evaluated_get(depsgraph)
        try:
            mesh = eval_obj.to_mesh(preserve_all_data_layers=False, depsgraph=depsgraph)
        except Exception:
            mesh = None
        if mesh is None:
            for corner in obj.bound_box:
                w = obj.matrix_world @ mathutils.Vector(corner)
                radius = max(radius, (w - center).length)
            continue
        try:
            for v in mesh.vertices:
                w = eval_obj.matrix_world @ v.co
                radius = max(radius, (w - center).length)
        finally:
            eval_obj.to_mesh_clear()
    if radius <= 1e-8:
        manual("Degenerate bounds radius; cannot normalize scale", targetRadius=target_radius)
    scale = target_radius / radius
    for obj in root_objects(objects):
        obj.location *= scale
        obj.scale *= scale
    bpy.context.view_layer.update()
    # apply scale after normalization
    roots = root_objects(objects)
    targets = roots if roots else objects
    bpy.ops.object.select_all(action="DESELECT")
    for obj in targets:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return {"sourceRadius": radius, "scale": scale, "targetRadius": target_radius}


def orient_forward(bpy, objects, forward, pitch_deg, yaw_deg, roll_deg, rotation_configured):
    # Forward orientation is a gameplay contract. We only apply explicit configured rotations;
    # if forward is required but no explicit rotation mapping is configured, emit manual.
    import mathutils

    forward_norm = str(forward).upper() if forward else None
    if forward_norm == "-Z":
        if not rotation_configured:
            manual(
                "Forward orientation required (-Z) but no explicit rotation configured; set rotationDeg [pitch,yaw,roll] or yaw/pitch/roll in sources",
                forward=forward,
            )
    elif forward_norm is not None and forward_norm not in ("+Z", "+X", "-X", "+Y", "-Y"):
        manual(f"Unsupported forward value: {forward}", forward=forward)

    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)
    roll = math.radians(roll_deg)
    rot = mathutils.Euler((pitch, yaw, roll), 'XYZ').to_matrix().to_4x4()
    for obj in root_objects(objects):
        obj.matrix_world = rot @ obj.matrix_world
    bpy.context.view_layer.update()
    roots = root_objects(objects)
    targets = roots if roots else objects
    bpy.ops.object.select_all(action="DESELECT")
    for obj in targets:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return {
        "forward": forward_norm,
        "appliedRotationDeg": [pitch_deg, yaw_deg, roll_deg],
        "rotationConfigured": bool(rotation_configured),
    }


def export_glb(bpy, output, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=output,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )


def main():
    args = parse_args()
    try:
        import bpy  # type: ignore
    except Exception as e:
        emit({"status": "failed", "reason": f"bpy not available: {e}"})
        raise SystemExit(1)

    source = os.path.abspath(args.source)
    output = os.path.abspath(args.output)

    if not os.path.exists(source):
        manual("Source file missing", id=args.id, source=args.source, output=args.output)

    try:
        target_radius = parse_target_radius(args.target_radius, asset_id=args.id)
        pitch_deg, yaw_deg, roll_deg = parse_rotation_deg(args)
        rotation_configured = args.rotation_deg is not None or any(
            abs(v) > 1e-9 for v in (args.yaw_deg, args.pitch_deg, args.roll_deg)
        )

        clean_scene(bpy)
        import_source(bpy, source)
        objects = select_export_objects(bpy, args.node_filter)
        apply_transforms(bpy, objects)
        center = recenter_to_bounds_center(bpy, objects)
        scale_info = normalize_scale_to_radius(bpy, objects, target_radius, asset_id=args.id)
        orient_info = orient_forward(bpy, objects, args.forward, pitch_deg, yaw_deg, roll_deg, rotation_configured)
        export_glb(bpy, output, objects)
        emit({
            "status": "exported",
            "id": args.id,
            "source": args.source,
            "output": args.output,
            "objectCount": len(objects),
            "objects": [obj.name for obj in objects[:30]],
            "centeredFrom": [float(center.x), float(center.y), float(center.z)],
            "scale": scale_info,
            "orientation": orient_info,
        })
    except SystemExit:
        raise
    except Exception as e:
        fail(str(e), id=args.id, source=args.source, output=args.output)


if __name__ == "__main__":
    main()
