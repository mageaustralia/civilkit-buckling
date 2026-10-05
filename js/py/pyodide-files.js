/* The Pyodide release the Python console's full runtime self-hosts, pinned: every file's size
   and SHA-256, and the packages hosted with it (their import names and dependencies, from the
   release's pyodide-lock.json). Written by node tools/fetch-pyodide.mjs --pin; do not edit.
   tools/fetch-pyodide.mjs fetches the files into PYODIDE.dir and checks them against these. */
export const PYODIDE = {
 "version": "314.0.7",
 "python": "3.14.2",
 "source": "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/",
 "dir": "vendor/pyodide/314.0.7/",
 "core": [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json"
 ],
 "files": {
  "pyodide.mjs": {
   "size": 17931,
   "sha256": "6f1d60f7bf529beb300f0f47983c921d3982363640ba20af0e38efdddbc66109"
  },
  "pyodide.asm.mjs": {
   "size": 1250344,
   "sha256": "f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635"
  },
  "pyodide.asm.wasm": {
   "size": 9598218,
   "sha256": "cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6"
  },
  "python_stdlib.zip": {
   "size": 2545637,
   "sha256": "fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a"
  },
  "pyodide-lock.json": {
   "size": 119077,
   "sha256": "5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010"
  },
  "contourpy-1.3.3-cp314-cp314-pyemscripten_2026_0_wasm32.whl": {
   "size": 118874,
   "sha256": "0ac15ebf9f820d2d1c3526388aa2818b631cb6c4aae1682efd6b4cc12c1f302c"
  },
  "cycler-0.12.1-py3-none-any.whl": {
   "size": 8321,
   "sha256": "8ee450085f15b47f78b034d60059af6a3649e98fa5dde073363437742cc0b4ea"
  },
  "fonttools-4.62.1-py3-none-any.whl": {
   "size": 1152647,
   "sha256": "0d1516e073fd0a8d8e6d9af46417b6a26209a42518024a18f7085e72d2599605"
  },
  "kiwisolver-1.5.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl": {
   "size": 36616,
   "sha256": "47781998156721147c128a3c74547d5703e0e3cc454d8203e629339368308a93"
  },
  "matplotlib-3.10.8-cp314-cp314-pyemscripten_2026_0_wasm32.whl": {
   "size": 6982033,
   "sha256": "722857932f8f62eac64f8439af15c94d427f9fb945f9590cd242805c983d2d54"
  },
  "numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl": {
   "size": 2960568,
   "sha256": "a292c1f5d7d8a2208cd5e94fc467604c131cabcd2fc14fed6eefde121e7fabdf"
  },
  "packaging-26.1-py3-none-any.whl": {
   "size": 95852,
   "sha256": "565acbbea54da30348b6d68b6a54373e6f777987db9f1db6966b4b3a5060d303"
  },
  "pillow-12.2.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl": {
   "size": 1037806,
   "sha256": "e29838b7a756e4ee0f27a9cfa9a387ee0dfa2e9dd44be2dd595130b9f9d93ac3"
  },
  "pyparsing-3.3.2-py3-none-any.whl": {
   "size": 122781,
   "sha256": "f0dd8225b5f8e945980b400bd465b4b90cb0498a2eede0d9dbea98372f6110c5"
  },
  "python_dateutil-2.9.0.post0-py2.py3-none-any.whl": {
   "size": 229892,
   "sha256": "9b13365edf9c188f570baf9c540bbb3029ada2a2dacb9694b3659941693ee9e5"
  },
  "pytz-2026.1.post1-py2.py3-none-any.whl": {
   "size": 510489,
   "sha256": "b8249d6450146e0b61e6d710dc02ebb35a904796c4c2f97fe87d4ac5872db36a"
  },
  "scipy-1.18.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl": {
   "size": 14029750,
   "sha256": "17ee329a957863516d1bb6a6aaa0c60576fac027e9cd3d43de27f58b5b599b50"
  },
  "six-1.17.0-py2.py3-none-any.whl": {
   "size": 11050,
   "sha256": "228c50f73aa7addf2c2ccf2979c256802a59ab69cad8152b31b9443cc8140f42"
  }
 },
 "packages": {
  "contourpy": {
   "name": "contourpy",
   "version": "1.3.3",
   "file": "contourpy-1.3.3-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
   "imports": [
    "contourpy"
   ],
   "depends": [
    "numpy"
   ]
  },
  "cycler": {
   "name": "cycler",
   "version": "0.12.1",
   "file": "cycler-0.12.1-py3-none-any.whl",
   "imports": [
    "cycler"
   ],
   "depends": [
    "six"
   ]
  },
  "fonttools": {
   "name": "fonttools",
   "version": "4.62.1",
   "file": "fonttools-4.62.1-py3-none-any.whl",
   "imports": [
    "fontTools"
   ],
   "depends": []
  },
  "kiwisolver": {
   "name": "kiwisolver",
   "version": "1.5.0",
   "file": "kiwisolver-1.5.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
   "imports": [
    "kiwisolver"
   ],
   "depends": []
  },
  "matplotlib": {
   "name": "matplotlib",
   "version": "3.10.8",
   "file": "matplotlib-3.10.8-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
   "imports": [
    "pylab",
    "mpl_toolkits",
    "matplotlib"
   ],
   "depends": [
    "contourpy",
    "cycler",
    "fonttools",
    "kiwisolver",
    "numpy",
    "packaging",
    "pillow",
    "pyparsing",
    "python-dateutil",
    "pytz"
   ]
  },
  "numpy": {
   "name": "numpy",
   "version": "2.4.6",
   "file": "numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
   "imports": [
    "numpy"
   ],
   "depends": []
  },
  "packaging": {
   "name": "packaging",
   "version": "26.1",
   "file": "packaging-26.1-py3-none-any.whl",
   "imports": [
    "packaging"
   ],
   "depends": []
  },
  "pillow": {
   "name": "Pillow",
   "version": "12.2.0",
   "file": "pillow-12.2.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
   "imports": [
    "PIL"
   ],
   "depends": []
  },
  "pyparsing": {
   "name": "pyparsing",
   "version": "3.3.2",
   "file": "pyparsing-3.3.2-py3-none-any.whl",
   "imports": [
    "pyparsing"
   ],
   "depends": []
  },
  "python-dateutil": {
   "name": "python-dateutil",
   "version": "2.9.0.post0",
   "file": "python_dateutil-2.9.0.post0-py2.py3-none-any.whl",
   "imports": [
    "dateutil"
   ],
   "depends": [
    "six"
   ]
  },
  "pytz": {
   "name": "pytz",
   "version": "2026.1.post1",
   "file": "pytz-2026.1.post1-py2.py3-none-any.whl",
   "imports": [
    "pytz"
   ],
   "depends": []
  },
  "scipy": {
   "name": "scipy",
   "version": "1.18.0",
   "file": "scipy-1.18.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
   "imports": [
    "scipy"
   ],
   "depends": [
    "numpy"
   ]
  },
  "six": {
   "name": "six",
   "version": "1.17.0",
   "file": "six-1.17.0-py2.py3-none-any.whl",
   "imports": [
    "six"
   ],
   "depends": []
  }
 },
 "others": {
  "Bio": "biopython",
  "BioSQL": "biopython",
  "CoolProp": "coolprop",
  "Crypto": "pycryptodome",
  "IPython": "ipython",
  "InSpice": "inspice",
  "MySQLdb": "mysqlclient",
  "PhiSpyModules": "phispy",
  "PhiSpyRepeatFinder": "phispy",
  "_argon2_cffi_bindings": "argon2-cffi-bindings",
  "_distutils_hack": "setuptools",
  "_pyrsistent_version": "pyrsistent",
  "_pytest": "pytest",
  "_yaml": "pyyaml",
  "_zengl": "zengl",
  "affine": "affine",
  "aiohappyeyeballs": "aiohappyeyeballs",
  "aiohttp": "aiohttp",
  "aiosignal": "aiosignal",
  "altair": "altair",
  "annotated_doc": "annotated-doc",
  "annotated_types": "annotated-types",
  "anyio": "anyio",
  "argon2": "argon2-cffi",
  "astropy": "astropy",
  "astropy_iers_data": "astropy_iers_data",
  "asttokens": "asttokens",
  "async_timeout": "async-timeout",
  "asyncpg": "asyncpg",
  "atomicwrites": "atomicwrites",
  "attr": "attrs",
  "attrs": "attrs",
  "audioop": "audioop-lts",
  "b2d": "b2d",
  "bcrypt": "bcrypt",
  "bigtests": "screed",
  "bilby_cython": "bilby.cython",
  "bitarray": "bitarray",
  "bitstring": "bitstring",
  "bleach": "bleach",
  "bokeh": "bokeh",
  "boost_histogram": "boost-histogram",
  "bottleneck": "Bottleneck",
  "brotli": "brotli",
  "bs4": "beautifulsoup4",
  "cachetools": "cachetools",
  "cartopy": "Cartopy",
  "casadi": "casadi",
  "cbor_diag": "cbor-diag",
  "certifi": "certifi",
  "cffi": "cffi",
  "cffi_example": "cffi_example",
  "cftime": "cftime",
  "charset_normalizer": "charset-normalizer",
  "clarabel": "clarabel",
  "click": "click",
  "cligj": "cligj",
  "clingo": "clingo",
  "cloudpickle": "cloudpickle",
  "cmyt": "cmyt",
  "cobs": "cobs",
  "colorspacious": "colorspacious",
  "coverage": "coverage",
  "crc32c": "crc32c",
  "crcmod": "crcmod",
  "cryptography": "cryptography",
  "cssselect": "cssselect",
  "cv2": "opencv-python",
  "cvxpy": "cvxpy-base",
  "cysignals": "cysignals",
  "cytoolz": "cytoolz",
  "decorator": "decorator",
  "demes": "demes",
  "deprecated": "deprecated",
  "deprecation": "deprecation",
  "diskcache": "diskcache",
  "distlib": "distlib",
  "distro": "distro",
  "dns": "dnspython",
  "docutils": "docutils",
  "donfig": "donfig",
  "duckdb": "duckdb",
  "erfa": "pyerfa",
  "ewah_bool_utils": "ewah_bool_utils",
  "exceptiongroup": "exceptiongroup",
  "executing": "executing",
  "fastapi": "fastapi",
  "fiona": "fiona",
  "flirt": "python-flirt",
  "freesasa": "freesasa",
  "frozenlist": "frozenlist",
  "fsspec": "fsspec",
  "future": "future",
  "galpy": "galpy",
  "geopandas": "geopandas",
  "gmpy2": "gmpy2",
  "google": "protobuf",
  "google_crc32c": "google-crc32c",
  "gridfs": "pymongo",
  "h11": "h11",
  "h3": "h3",
  "h5py": "h5py",
  "healpy": "healpy",
  "highspy": "highspy",
  "html5lib": "html5lib",
  "httpcore": "httpcore",
  "httpx": "httpx",
  "idna": "idna",
  "igraph": "igraph",
  "imageio": "imageio",
  "iminuit": "iminuit",
  "iniconfig": "iniconfig",
  "isympy": "sympy",
  "jedi": "jedi",
  "jinja2": "Jinja2",
  "jiter": "jiter",
  "joblib": "joblib",
  "jsonpatch": "jsonpatch",
  "jsonpointer": "jsonpointer",
  "jsonschema": "jsonschema",
  "jsonschema_specifications": "jsonschema_specifications",
  "lakers": "lakers-python",
  "lazy_loader": "lazy_loader",
  "lazy_object_proxy": "lazy-object-proxy",
  "libcst": "libcst",
  "librt": "librt",
  "lightgbm": "lightgbm",
  "logbook": "logbook",
  "lxml": "lxml",
  "lz4": "lz4",
  "markupsafe": "MarkupSafe",
  "matplotlib-inline": "matplotlib-inline",
  "memory_allocator": "memory-allocator",
  "micropip": "micropip",
  "ml_dtypes": "ml_dtypes",
  "mmh3": "mmh3",
  "more_itertools": "more-itertools",
  "mpmath": "mpmath",
  "msgpack": "msgpack",
  "msgspec": "msgspec",
  "msprime": "msprime",
  "multidict": "multidict",
  "munch": "munch",
  "mypy": "mypy",
  "mypyc": "mypy",
  "nacl": "pynacl",
  "narwhals": "narwhals",
  "ndindex": "ndindex",
  "netCDF4": "netcdf4",
  "networkx": "networkx",
  "newick": "newick",
  "nh3": "nh3",
  "nlopt": "nlopt",
  "nltk": "nltk",
  "numcodecs": "numcodecs",
  "numpy-tests": "numpy-tests",
  "openai": "openai",
  "optlang": "optlang",
  "orjson": "orjson",
  "pandas": "pandas",
  "parso": "parso",
  "patsy": "patsy",
  "pcodec": "pcodec",
  "peewee": "peewee",
  "pi_heif": "pi-heif",
  "pillow_heif": "pillow-heif",
  "pkgconfig": "pkgconfig",
  "platformdirs": "platformdirs",
  "pluggy": "pluggy",
  "ply": "ply",
  "polars": "polars",
  "prompt_toolkit": "prompt_toolkit",
  "propcache": "propcache",
  "psycopg": "psycopg",
  "psycopg_binary": "psycopg-binary",
  "psycopg_c": "psycopg-c",
  "pure_eval": "pure-eval",
  "py": "py",
  "pyarrow": "pyarrow",
  "pyclipper": "pyclipper",
  "pycparser": "pycparser",
  "pydantic": "pydantic",
  "pydantic_core": "pydantic_core",
  "pydoc_data": "pydoc_data",
  "pygame": "pygame-ce",
  "pygments": "Pygments",
  "pyheif": "pyheif",
  "pyiceberg": "pyiceberg",
  "pyinstrument": "pyinstrument",
  "pymongo": "pymongo",
  "pyodide_http": "pyodide-http",
  "pyproj": "pyproj",
  "pyroaring": "pyroaring",
  "pyrodigal": "pyrodigal",
  "pyrsistent": "pyrsistent",
  "pysam": "pysam",
  "pysat": "python-sat",
  "pytest": "pytest",
  "pytest_asyncio": "pytest-asyncio",
  "pytest_benchmark": "pytest-benchmark",
  "pytest_httpx": "pytest_httpx",
  "python_calamine": "python-calamine",
  "python_solvespace": "python-solvespace",
  "pywt": "pywavelets",
  "pyxirr": "pyxirr",
  "rasterio": "rasterio",
  "rateslib": "rateslib",
  "rebound": "rebound",
  "reboundx": "reboundx",
  "referencing": "referencing",
  "regex": "regex",
  "requests": "requests",
  "retrying": "retrying",
  "rich": "rich",
  "rpds": "rpds-py",
  "ruamel": "ruamel.yaml",
  "safetensors": "safetensors",
  "screed": "screed",
  "sentencepiece": "sentencepiece",
  "setuptools": "setuptools",
  "shapefile": "pyshp",
  "shapely": "shapely",
  "simplejson": "simplejson",
  "sisl": "sisl",
  "sisl_toolbox": "sisl",
  "skimage": "scikit-image",
  "sklearn": "scikit-learn",
  "smart_open": "smart-open",
  "sniffio": "sniffio",
  "sortedcontainers": "sortedcontainers",
  "soundfile": "soundfile",
  "soupsieve": "soupsieve",
  "sourmash": "sourmash",
  "soxr": "soxr",
  "sparseqr": "sparseqr",
  "sqlalchemy": "sqlalchemy",
  "stack_data": "stack-data",
  "starlette": "starlette",
  "statsmodels": "statsmodels",
  "strictyaml": "strictyaml",
  "svgwrite": "svgwrite",
  "swiglpk": "swiglpk",
  "sympy": "sympy",
  "taglib": "pytaglib",
  "tblib": "tblib",
  "termcolor": "termcolor",
  "texttable": "texttable",
  "texture2ddecoder": "texture2ddecoder",
  "threadpoolctl": "threadpoolctl",
  "tiktoken": "tiktoken",
  "tiktoken_ext": "tiktoken",
  "tlz": "toolz",
  "tomli": "tomli",
  "tomli_w": "tomli-w",
  "toolz": "toolz",
  "tqdm": "tqdm",
  "traitlets": "traitlets",
  "traits": "traits",
  "tree_sitter": "tree-sitter",
  "tree_sitter_go": "tree-sitter-go",
  "tree_sitter_java": "tree-sitter-java",
  "tree_sitter_python": "tree-sitter-python",
  "tskit": "tskit",
  "typing_extensions": "typing-extensions",
  "typing_inspection": "typing-inspection",
  "tzdata": "tzdata",
  "ujson": "ujson",
  "uncertainties": "uncertainties",
  "unix_timezones": "pyodide-unix-timezones",
  "unyt": "unyt",
  "urllib3": "urllib3",
  "vega_datasets": "vega-datasets",
  "vrplib": "vrplib",
  "wcwidth": "wcwidth",
  "webencodings": "webencodings",
  "wordcloud": "wordcloud",
  "wrapt": "wrapt",
  "xarray": "xarray",
  "xgboost": "xgboost",
  "xlrd": "xlrd",
  "xxhash": "xxhash",
  "xyzservices": "xyzservices",
  "yaml": "pyyaml",
  "yarl": "yarl",
  "yt": "yt",
  "zarr": "zarr",
  "zengl": "zengl",
  "zfpy": "zfpy",
  "zstandard": "zstandard"
 }
};
