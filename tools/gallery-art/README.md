# Gallery stills

Run `python tools/gallery-art/build.py` with Pillow and numpy installed.

Reaper uses the original still from commit `44a624f`, checked against the source receipt in `tools/reaper/verification.json`. The composition changes its crop, lighting and background. The receipt describes that original render and GLB, rather than the newly composed image.

NXP Cup is illustrative track artwork based on the existing analytic lane. It does not depict a measured race course or result.

Both final images are 1600 by 1600 pixels. The generator verifies the original model and still hashes and bounds the combined output size to 2 MB.
