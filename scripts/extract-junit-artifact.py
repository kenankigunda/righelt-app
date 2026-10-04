"""Extract a selected JUnit archive without allowing paths or links to escape."""
import pathlib
import stat
import sys
import zipfile

archive, destination = map(pathlib.Path, sys.argv[1:])
with zipfile.ZipFile(archive) as source:
    entries = source.infolist()
    for entry in entries:
        path = pathlib.PurePosixPath(entry.filename)
        mode = entry.external_attr >> 16
        if (path.is_absolute() or ".." in path.parts or "\\" in entry.filename
                or ":" in entry.filename or stat.S_ISLNK(mode)):
            raise ValueError("Unsafe archive entry")
    source.extractall(destination)
