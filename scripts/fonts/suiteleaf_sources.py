"""Download the open fonts the SuiteLeaf fonts are built from.

Every download is checked against a pinned SHA-256, and only the files the build
needs are extracted. Run on its own to fill the cache:

    python scripts/fonts/suiteleaf_sources.py [--cache DIR]
"""
import argparse
import fnmatch
import hashlib
import io
import json
import os
import tarfile
import urllib.request
import zipfile
from pathlib import Path

DEFAULT_CACHE = Path.home() / ".cache" / "suiteleaf-fonts"
GF = "https://raw.githubusercontent.com/google/fonts/a4c0b21f839d7ac65a7d8b49eb81bddd110774a3/ofl/"
DEB = "https://deb.debian.org/debian/pool/main/"


def gf(path, sha256):
    return {"url": GF + path.replace("[", "%5B").replace("]", "%5D"), "sha256": sha256, "kind": "file", "dest": "gf/" + path}


SOURCES = [
    gf("archivo/Archivo[wdth,wght].ttf", "0e094a7d3c7c4c25cf1310c4b30014f1dae9332220b1c2c88f4fa996f0b05053"),
    gf("archivo/OFL.txt", "108b4e57c9c796d3d38d0428ca7ee39de47ad93187302718d9b2d8864b9b716b"),
    gf("akt/Akt[wght].ttf", "3da5013ec56bf5a83cccd1d5601b89fa58a6cda5b3fd0e5f8d18ee3690272c05"),
    gf("akt/OFL.txt", "a27d7054c92711c58325a652f1968c92d1825a48bf745d50df802ec3d0ebb642"),
    gf("alegreyasans/AlegreyaSans-ExtraBold.ttf", "3861f08a77d5c1b3b311055913443b07337a4b7abaff21a8cdb51fc0ae980b9e"),
    gf("alegreyasans/OFL.txt", "0677891e6a143f297350d260ad766ad33bfc18ed5fa4f213acf648d6b597ec1a"),
    gf("chironheihk/ChironHeiHK[wght].ttf", "0d788ded72dc88f478818182179af4c7cd143df0bf86557d29729ab132333930"),
    gf("chironheihk/OFL.txt", "68b9a31cc191bb8f5f428f191209f7d08c6b5b0d4816a293e5bd230724e84f10"),
    gf("golostext/GolosText[wght].ttf", "17bb58fb69aec2dfb047a2ebf52534023e9b688c97a6b7ac795b0a72912c2063"),
    gf("golostext/OFL.txt", "ff532f9e8789f09a9fdffc3c0954eedfb0a48be77b2e2eb90f5f82e4f347f50c"),
    gf("gothica1/GothicA1-ExtraBold.ttf", "37a65353a646fea5a1ac90585d1bb8f9b997ecae0b79c4f1f187566f910e3f9d"),
    gf("gothica1/OFL.txt", "ed95c33f80ccca002e3a360b683c43368f9c5eb024e5b992abb51af3c10b59bc"),
    gf("jetbrainsmono/JetBrainsMono[wght].ttf", "48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda"),
    gf("jetbrainsmono/OFL.txt", "b2fe5e8987594e9ffd1d2ca52a2f5d73eb8335243893c5d6254b5ad69269591d"),
    gf("lato/Lato-Black.ttf", "808c62839c62dbce7de689af7603666fc7f8b81e0df537d8a5212c87580d4337"),
    gf("lato/OFL.txt", "74ba064d03f1f1c4a952da936c3eb71866c34404916734de3cae73b34357e59e"),
    gf("notosansmono/NotoSansMono[wdth,wght].ttf", "2cb2adb378a8f574213e23df697050b83c54c27df465a2015552740b2769a081"),
    gf("notosansmono/OFL.txt", "cee9892f9f0cc8fe882c9e9537ee6a89621d86ee7ceaf70b02e2b2b1c25c061a"),
    gf("notoserifhk/NotoSerifHK[wght].ttf", "66108860e321aa413e7cb346448b4a418b779d94ae392accb32d163c024ae661"),
    gf("notoserifhk/OFL.txt", "1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9"),
    gf("overpass/Overpass[wght].ttf", "970717df17a7f9911dee45f60695d05bfa9d745fa0a11fc5c348371fa21f0073"),
    gf("overpass/OFL.txt", "86e5ff25c701ec446d20b1a85b02ee6d36de8503a7288a4c948f5459809af1f0"),
    gf("sourcecodepro/SourceCodePro[wght].ttf", "b400fc584e10aff25d0e775ce181b4fc1c5ea1b5dc37b81aeb2084375b945790"),
    gf("sourcecodepro/OFL.txt", "cb30d3086a8b3ce0b9e3690bf48d6620402b61160bc658076f95180ccd9e9dae"),
    gf("notosanssymbols2/NotoSansSymbols2-Regular.ttf", "7d5fb73b7ca67a6798101741f5d280a3d016a56a197afcd4199dbb57b4b82a21"),
    gf("notosanssymbols2/OFL.txt", "b118dd41337806a5d4797052c77caf3bd096aed783e5eb21b4d11154351e1ac0"),
    gf("notosanssymbols/NotoSansSymbols[wght].ttf", "f7e7e04b4a24b6c78893d50cbfd2b2f6cae49617ab047bfef668d252adb128f7"),
    gf("notosanssymbols/OFL.txt", "b118dd41337806a5d4797052c77caf3bd096aed783e5eb21b4d11154351e1ac0"),
    gf("notoemoji/NotoEmoji[wght].ttf", "de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551"),
    gf("notoemoji/OFL.txt", "500bb1ccf43df7bbb522112f9133a52b16e1c35e809632f5d8609b179152de5b"),
    gf("notosansmath/NotoSansMath-Regular.ttf", "3f495fe933c06786e4d5f6d86b8ee70b6753a68ee3b9d87528726de0f6e2c47d"),
    gf("notosansmath/OFL.txt", "403a95275b469061b7d4371c328e0ada3bc7d63328abe2e88aad5cd243b2fe21"),
    gf("notosans/NotoSans[wdth,wght].ttf", "bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d"),
    gf("notosans/OFL.txt", "cee9892f9f0cc8fe882c9e9537ee6a89621d86ee7ceaf70b02e2b2b1c25c061a"),
    gf("carlito/Carlito-Regular.ttf", "f6418f708baede9789daef5d458c0f53d2a888af9820e8062934e504fedc6595"),
    gf("carlito/Carlito-Bold.ttf", "bb5d20f79b82599ec72983597437373a80f2d2085fa91fc144fd74e876a594db"),
    gf("carlito/Carlito-Italic.ttf", "0b019225e58d702bfedcbd35c21696769f8ee115cb6343f84c2f240312450d1c"),
    gf("carlito/Carlito-BoldItalic.ttf", "b32928186c119599e03ca6a1ffc680fdcb7fac95772f4b95d989cf6cd3861517"),
    gf("carlito/OFL.txt", "58402f82a7c332a700294988fe7554fbb0a63a8d27ccc1ee3bbc640311990a00"),
gf("andika/Andika-Bold.ttf", "4361126189a2d0e0da66999352db58aaf1b4ca940faf8a8239d725f8303d890d"),
    gf("cardo/Cardo-Italic.ttf", "52c51cfde3a827dd9428511c4a968699952b8a917c5f0e97be782cbfa1880f9c"),
    gf("cardo/Cardo-Regular.ttf", "bcb81f376f1c3892c7026dabf2beafbd1a7ee8ae95d132ee7d4ff7d7c3988261"),
    gf("cardo/OFL.txt", "8e28b778b6e1a7ff9ca72f4dee2d53120aa2856dc1bfd0be44307e365b0e45bb"),
    gf("caudex/Caudex-Regular.ttf", "dbb493e1adc50aaec52071535e6fccf4176793c79545f54d95a812cbfb85169b"),
    gf("caudex/OFL.txt", "1e5bf8207a40678bc401e2e5456d0db1f2a183b550a30976b48dcdd6a4e4c46c"),
    gf("charissil/CharisSIL-Bold.ttf", "68460d2b76c8f781b49f9168f2c7dc3c9f7b788a3a1b8f267c5fa6bb47d5c64d"),
    gf("ebgaramond/EBGaramond-Italic[wght].ttf", "bba2c4499c93c9612b90b9825d32b07da52fce2fe57562a1eb6b833553f93c4e"),
    gf("ebgaramond/EBGaramond[wght].ttf", "ef9512f92f6d579e5dc75af59a5a4b1b8b47d2eda89e00b954d44520e5369027"),
    gf("ebgaramond/OFL.txt", "0985066662eb755ed3683ae5482a81a9195b49ce3f7e165cc2388b3dbece7dd7"),
    gf("gentiumbookplus/GentiumBookPlus-Bold.ttf", "b39c3fb12e2e15e2336f2ec6d051c778618ec25f7360bc4765bfe755b408c011"),
    gf("gentiumbookplus/GentiumBookPlus-Italic.ttf", "7a0ab4bd78701fa46d325e362654c41a47e2a0a5cb4a3eebc94dce89c2ee7df1"),
    gf("gentiumbookplus/GentiumBookPlus-Regular.ttf", "fe7b64eeacc430fcf46836a6f0dfe00d2c5a15483ed36692a2a185cb23ec2a5c"),
    gf("gentiumplus/GentiumPlus-BoldItalic.ttf", "35e7ad6591694a832de59df1899bccc88e0af8ad5fff20533b63751747851c71"),
    gf("gentiumplus/GentiumPlus-Italic.ttf", "18df1f3ddf09cf72338f25c45ca0d1922fb5e86cdd748522dbd6bede4fb1f99d"),
    gf("gentiumplus/OFL.txt", "c309a440be606e283ccacc746662d714b9c5b5a7a0a10dd2514b90206b55ddfe"),
    gf("googlesans/GoogleSans-Italic[GRAD,opsz,wght].ttf", "b6662abd2131cad1b248750149a7f2b644f871ebcc9af7fe4cd1135cd290b6d1"),
    gf("googlesans/GoogleSans[GRAD,opsz,wght].ttf", "d0a87d835a944b8b40d0e82a5651bb59ab97b936a2aeed5946eb57e7b2a3a90a"),
    gf("googlesans/OFL.txt", "2b75ef20f13d83a7514aee452c4782c20cdc9ff2dee17600f44d37a06d4fb958"),
    gf("inter/Inter-Italic[opsz,wght].ttf", "acd98e64795781b2058f07b18475e0ecee2a0fe2b42a49e2f9e37d0d6bf66ce6"),
    gf("inter/Inter[opsz,wght].ttf", "29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031"),
    gf("inter/OFL.txt", "5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57"),
    gf("intertight/InterTight-Italic[wght].ttf", "15d3edf0c3d2560658529b8c4c7398d06c730a4695484c680b6c9ca9e4385be2"),
    gf("intertight/OFL.txt", "50240ab035cf1b6b3307940235481d515c4b6de3ab1fa843dbe59e7892cb9d58"),
    gf("libertinusmath/LibertinusMath-Regular.ttf", "6eaebb1260c45328a49299a614eb20cee6d0b5c2fbb0d48314def159e0715318"),
    gf("libertinusmath/OFL.txt", "543bbe3d066d7ee6b062b6911220355c72720dc16003e5086885d6f543a6f376"),
    gf("notonaskharabic/NotoNaskhArabic[wght].ttf", "67b5a525a661b607971fbd3f96a81b89d3a768e74534fca84f18ac97e6fab72f"),
    gf("notonaskharabic/OFL.txt", "a7a5a25eb188bf1cd96982030d53e23c33485c69b1044a562254226857ee13af"),
    gf("notoserifarmenian/NotoSerifArmenian[wdth,wght].ttf", "9354b74384d093d59f9a4ad958e188808d58b6f15debeaab18e07bc432f8ce0c"),
    gf("notoserifarmenian/OFL.txt", "0468358b316f69f405b55cadf8a8314e16e3610b8feaad96772bd5d968112d02"),
    gf("notoserifdisplay/NotoSerifDisplay-Italic[wdth,wght].ttf", "daad4d314708839a5c343f26e75467edf6c05a3a726502c98974dd3e240e6516"),
    gf("notoserifdisplay/NotoSerifDisplay[wdth,wght].ttf", "4b661adcf6a5d38bf5befdc4d976e8a7238a4aeb57e62c1c1a67775380a09df9"),
    gf("notoserifdisplay/OFL.txt", "5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6"),
gf("andika/Andika-Regular.ttf", "202b96b1f174a4a43baefe885b40dacacb81786755efd08ed4b7704e79c45515"),
    gf("andika/OFL.txt", "43ee152fcd7be0c6eb3468f3012e776cb75bf88f5dec548be0aa4619bf438f9e"),
    gf("cairo/Cairo[slnt,wght].ttf", "667c987182391c91f4e57a2f455b1794fb5e3ee6ca4ef3383e86bb690fa9c964"),
    gf("cairo/OFL.txt", "a4554e1799d42e1405924b61eb0e0722ae1623b1f1f07f995348f96c496362a9"),
    gf("cairoplay/CairoPlay[slnt,wght].ttf", "2c275b43ace54233a0960c3aa1d05b4e9e0e396a501cd3f8d446b16cc3362745"),
    gf("cairoplay/OFL.txt", "a4554e1799d42e1405924b61eb0e0722ae1623b1f1f07f995348f96c496362a9"),
    gf("charissil/CharisSIL-BoldItalic.ttf", "acdf6dc54c0ee5e03cae3398f64133c335084cd1ecab655f2a8636c5d56acedb"),
    gf("charissil/CharisSIL-Italic.ttf", "e776e2961117b39cf924c0139de01748a77b2fcb99c437b2c77bdd9401606c13"),
    gf("charissil/CharisSIL-Regular.ttf", "346337374aa347d64ee015b26d441f1970d8631914e2f3941b00e1c4761e28c5"),
    gf("charissil/OFL.txt", "0acda775b4dedaf980821f590206a692779ee495170018ee2b9caf1c50fc136a"),
    gf("chironheihk/ChironHeiHK-Italic[wght].ttf", "e9e78771ef2cedf21cc01cf3f547036f55e5b183190473cb6f3804f49507707b"),
    gf("chocolateclassicalsans/ChocolateClassicalSans-Regular.ttf", "e6345f3d92c7a9b7044c31a87d9b61f50220b08c0f1dcc2736e94c2aa587ce03"),
    gf("chocolateclassicalsans/OFL.txt", "2e07464fdfc781cd68f976fcfab13ad30913c04465571c33eaddc7db20f74ad6"),
    gf("cousine/Cousine-BoldItalic.ttf", "848e858726fee0ae27b754e4cd6a2755209bf1428a8c91f747696d58c33906c3"),
    gf("cousine/Cousine-Italic.ttf", "ea2a76ae3d0ece9cd59f0d30fdc08dd70e8f5f457beee5b0852a7b50c2286c7c"),
    gf("cousine/Cousine-Regular.ttf", "1da22250675fc4c42fcf3a9736c44bc0570516105331443b663fd5cfbd1412fe"),
    gf("cousine/OFL.txt", "b81c4d4dc0a9f72c9155e78187316e016e2012a8102468804173dc61468b906d"),
    gf("firasans/FiraSans-Bold.ttf", "a4d8e149ecdd4874a0726eb0af894488b3b31c423d6b0017c8f415ed1b795b45"),
    gf("firasans/FiraSans-BoldItalic.ttf", "1b96c16db9819bcaa9d588068bb397bb6e977c4874965d3d50d789a1943757eb"),
    gf("firasans/FiraSans-ExtraBoldItalic.ttf", "eb26df1afeec1f817977c8729b4a1ba5ef07d7c821d39cbff6348e491c748f5f"),
    gf("firasans/FiraSans-Italic.ttf", "a4204f9a8029c1c55daa5385ac95936f74abea3e232770f1fb2862a19d1dfa13"),
    gf("firasans/FiraSans-Medium.ttf", "cbc1842cbed8c1d1146ba7c9db97d8f28c9bedfd25f41c5b0e1259ca48622328"),
    gf("firasans/FiraSans-MediumItalic.ttf", "d892b7a6e874d839bc7e712b1d57cf64bcf8013ae143c3eab09e0fd9a0604411"),
    gf("firasans/FiraSans-Regular.ttf", "c29556a2719bf613ef3d5e070e40d903a8965d9c081beca1375dc1e6e0f93c23"),
    gf("firasans/FiraSans-SemiBold.ttf", "db0321f83eb3e9f527b8af384a1b3fefdc1039cf2b06fd39b3f61492bda9561c"),
    gf("firasans/FiraSans-SemiBoldItalic.ttf", "97dc5696fe0aabcabf7e041527e0ca39215661cb8174cd1a92c01d9fe224c73d"),
    gf("firasans/OFL.txt", "8f24842e9174beda18a556c2ae7d54f5dc444340c19a3a9ef77e23bca366adbd"),
    gf("firasanscondensed/FiraSansCondensed-Bold.ttf", "b9371052e58ec5b709153dd0fffc60b5205b4d3435cf957c2522705b31b0dbcc"),
    gf("firasanscondensed/FiraSansCondensed-ExtraBold.ttf", "d1e5181a65e04970ef17b83fa518277658217081a032c7f60b7ac0f101347cf2"),
    gf("firasanscondensed/OFL.txt", "8f24842e9174beda18a556c2ae7d54f5dc444340c19a3a9ef77e23bca366adbd"),
    gf("firasansextracondensed/FiraSansExtraCondensed-MediumItalic.ttf", "c7ca21914a6ec284e464ea3f8bbc717464ed954d6f474956f4d3e44ee2328c89"),
    gf("firasansextracondensed/OFL.txt", "8f24842e9174beda18a556c2ae7d54f5dc444340c19a3a9ef77e23bca366adbd"),
    gf("gentiumbookplus/GentiumBookPlus-BoldItalic.ttf", "e557dd7a7f818fa482c3e63c7576c6d455f6f2e3bf9d84e0a11d1617e2bc1383"),
    gf("gentiumbookplus/OFL.txt", "c309a440be606e283ccacc746662d714b9c5b5a7a0a10dd2514b90206b55ddfe"),
    gf("gothica1/GothicA1-Medium.ttf", "c8a0eb56fa6b13448688fed0799d503fe536a8c6b7acfafdfd580edb9c4c2192"),
    gf("ibmplexsansarabic/IBMPlexSansArabic-Bold.ttf", "691e0c891a38637ae6bbdb69700f8042cb0724a137bee615068ffdb92244f61f"),
    gf("ibmplexsansarabic/IBMPlexSansArabic-Medium.ttf", "b8363ab9f733dfa4f8e96b8b2102c24b5cf4110fb96d1d3d9a9412f6fb49cf74"),
    gf("ibmplexsansarabic/IBMPlexSansArabic-Regular.ttf", "6f611412270a132bbac838da9259d4c68569b4175f3b3b8fa3fa36a30b56dab9"),
    gf("ibmplexsansarabic/IBMPlexSansArabic-SemiBold.ttf", "597bd5502e5997be4414e4c9c88834b30ff3784250c84f20bce2b20e53ebd467"),
    gf("ibmplexsansarabic/OFL.txt", "7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da"),
    gf("iosevkacharon/IosevkaCharon-Bold.ttf", "6929f4d263eef34bf72992782b8fd49aaf06a94a3bd02bc418bdc9e25892dbc5"),
    gf("iosevkacharon/IosevkaCharon-BoldItalic.ttf", "2d2e548d533903d608b9c6ee4a5262cbf7703d339a25593310cceb5e3c02814d"),
    gf("iosevkacharon/IosevkaCharon-Italic.ttf", "16fafa08364b9657f8acaea402ce0549a98b74cc10b9ca19dd674f3026b7b060"),
    gf("iosevkacharon/IosevkaCharon-Light.ttf", "47bf91a4348e0079f5ddcfe6649f6617e43e663541d8b51c05a512597eca09a2"),
    gf("iosevkacharon/IosevkaCharon-LightItalic.ttf", "7788641d2613c1ee0a733220acd954bae4d33ecf0074a6d19607e29e6b669293"),
    gf("iosevkacharon/IosevkaCharon-Medium.ttf", "fe4236724c45b1fe2073c30c0fb212fcd361a2f6f22c776a777e464fb8917553"),
    gf("iosevkacharon/IosevkaCharon-MediumItalic.ttf", "18396b7a0db5863e4e60bdab6d0d02bc57e31477a7a311d7eff94bc44d264914"),
    gf("iosevkacharon/IosevkaCharon-Regular.ttf", "a5a85271575eefce115a0c029c787bc8914d0c771bd1fdfc3776b7280a57d047"),
    gf("iosevkacharon/OFL.txt", "d322b7d6b9be80a87ef7a8e49573a376390621952e3d4abee4662fc41976686a"),
    gf("iosevkacharonmono/IosevkaCharonMono-Italic.ttf", "9c2df07a74f0fcd1b79da18a7c936a25f07cd665363a8b9bc89310f80a84a551"),
    gf("iosevkacharonmono/IosevkaCharonMono-LightItalic.ttf", "16d06baa8a498087fcb10cf67f2871d95aeb5501c86586a0cb0b6ad41b7c6d30"),
    gf("iosevkacharonmono/OFL.txt", "b2aef7a8ad51392460dab003ae1ea352b7a46bf1ec732ca5fea723b69ce1d8aa"),
    gf("lato/Lato-MediumItalic.ttf", "ecbce6cffa42d8a67afeb27a9d6e85d515e81481d4b2cece989e833a48048405"),
    gf("mplus1p/MPLUS1p-Bold.ttf", "76eb077b0a31ca33ca40238e47da5a17e2786741607cec09678d7d2e5ab1afc1"),
    gf("mplus1p/MPLUS1p-ExtraBold.ttf", "d17f745712668b0dcd95e42b3634a90a76195228d4abf88a0be8e98ddbc441b2"),
    gf("mplus1p/MPLUS1p-Medium.ttf", "28b2f52a40ae988064810b71d67e127df75a16e08d7df4e192d1006e4075394f"),
    gf("mplus1p/OFL.txt", "da15da6b1496d4de18f97e2ad1b722ef8a1c121149c2c93b2cf7eac6ac27b35c"),
    gf("notosans/NotoSans-Italic[wdth,wght].ttf", "58e6e0ebd1931b29a365aa2d3e2ee9a9e831a3af7cf3ad1462d4e72154f0b291"),
    gf("notosansarabic/NotoSansArabic[wdth,wght].ttf", "63111b5b2e074dd48cc67692e0a2726d86ee94c1c37fe8598257b7b4e87e869e"),
    gf("notosansarabic/OFL.txt", "07fc70bfeb985cc1a87a8587d0a0c80bab11c86c9dc3fd95b6f0cb332f983e96"),
    gf("notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf", "81374b375e9476e2fa5b31a9ee4bcab524a307270dd5bf033346c7ba932f226b"),
    gf("notosansdisplay/NotoSansDisplay[wdth,wght].ttf", "deaa68141fa5ad21bd17d7c11fa79183ceda19b32e40ff5c33874d42f3636dde"),
    gf("notosansdisplay/OFL.txt", "5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6"),
    gf("notosanslisu/NotoSansLisu[wght].ttf", "669592efd358c495000ae79201dbec736d877d04fabf4dfc4dfb887cd9eeac40"),
    gf("notosanslisu/OFL.txt", "1f65bfdc26d6bd6e57249c60a86ea355761fb9150694e50206175d3fa8d3c166"),
    gf("notoserif/NotoSerif-Italic[wdth,wght].ttf", "e87acbc6c0efd0d9a20d6a8cbbda2b266c14be3a3a6f5af8ec9d7b2460570ad1"),
    gf("notoserif/NotoSerif[wdth,wght].ttf", "4d8e6761424656867019081a1a01336f3cb086982682698714054fc33f782713"),
    gf("notoserif/OFL.txt", "cee9892f9f0cc8fe882c9e9537ee6a89621d86ee7ceaf70b02e2b2b1c25c061a"),
    gf("roundedmplus1c/OFL.txt", "67f64c5509e5151796599e3ad47c3131cbe0c80c4f9430b90236a1249c2eacc9"),
    gf("roundedmplus1c/RoundedMplus1c-Bold.ttf", "c358630584e8e2d8fbd6121d0f4693255ffef6d1e6d4f3441fd6e5a963a11f9e"),
    gf("roundedmplus1c/RoundedMplus1c-ExtraBold.ttf", "8e7c15901dca87f1451b356dda594f7d092ba252a5dcc47da74523a242493c36"),
    gf("savate/OFL.txt", "0c757edca5c56afa280139563437e84da51a4b98d387b039ac467fc8ea509c45"),
    gf("savate/Savate-Italic[wght].ttf", "c30e3f15cdf19846727bc5ed88eb96ed007d36b717cb867e1aa74acd0aadcc22"),
    gf("arimo/Arimo[wght].ttf", "e43898b143ec826ac8cb4034816458a7047fbe0836558de2a1f8c6223ae3e0ca"),
    gf("arimo/Arimo-Italic[wght].ttf", "a80fc54fd0233c1dfe298577c4d00f5ae81d5bb83510975e473c47e699b7f4ed"),
    gf("arimo/OFL.txt", "11cce536cd2f3864d767003af5dcd739e2e15818cf2279b6175edeadd3960992"),
    gf("notosansarabicui/NotoSansArabicUI[wdth,wght].ttf", "2d47090f7a3de2fd01ba8aff9a775263b3ab70a46cd2a6bfe3d1c3e1dd89ffe5"),
    gf("notosansarabicui/OFL.txt", "5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6"),
    gf("notonaskharabicui/NotoNaskhArabicUI[wght].ttf", "6bcf69fb867a773084baf29736b6410ff7a0fd67c821271fe6eb87ed2292b1cd"),
    gf("notonaskharabicui/OFL.txt", "5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6"),
    {"url": DEB + "f/fonts-horai-umefont/fonts-horai-umefont_670-5_all.deb",
     "sha256": "1b1ed2bef53ff395439ce3999b8c28dc8b9bff9d4d0de31cc440a1f331b4a9b9", "kind": "deb",
     "members": {"*/horai-umefont/ume-tgc5.ttf": "ume/ume-tgc5.ttf", "*/horai-umefont/ume-tmo3.ttf": "ume/ume-tmo3.ttf",
                 "*/doc/fonts-horai-umefont/copyright": "ume/copyright"}},
    {"url": "https://typedesign.replit.app/DMCAsansserif9.0-20252.zip",
     "sha256": "ee9a205e84fd8913f53e6845cfdbe7a915104d7d1989761bd0e0cd43ca5d436d", "kind": "zip",
     "members": {f"DMCAsansserif-v0900-{w}.ttf": f"dmca/DMCAsansserif-v0900-{w}.ttf" for w in ("400", "700", "400-i", "700-i")}},
    {"url": "https://api.github.com/repos/ArtifexSoftware/urw-base35-fonts/tarball/20200910",
     "sha256": "d46baaaf2264f35055c47b0450bad6372e6426ac86b0d224d3a17fa275b110f9", "kind": "tar",
     "members": {"*/fonts/P052-Roman.ttf": "urw/P052-Roman.ttf", "*/fonts/P052-Bold.ttf": "urw/P052-Bold.ttf",
                 "*/fonts/P052-Italic.ttf": "urw/P052-Italic.ttf", "*/fonts/P052-BoldItalic.ttf": "urw/P052-BoldItalic.ttf",
                 "*/fonts/LICENSE": "urw/LICENSE", "*/fonts/COPYING": "urw/COPYING"}},
    {"url": "https://mirrors.ctan.org/fonts/tex-gyre.zip",
     "sha256": "1773c470f9e388e087b68e3426e115af2cd236845a7e05ceb25b2a503409a7a3", "kind": "zip",
     "members": {"tex-gyre/opentype/texgyreheros-bold.otf": "texgyre/texgyreheros-bold.otf",
                 "tex-gyre/doc/GUST-FONT-LICENSE.txt": "texgyre/GUST-FONT-LICENSE.txt"}},
    {"url": "https://mirrors.ctan.org/fonts/tex-gyre-math.zip",
     "sha256": "373e47fa823bf1a645edbf772531fb9ff411d26a215dab253054635680bb6107", "kind": "zip",
     "members": {"tex-gyre-math/opentype/texgyredejavu-math.otf": "texgyre/texgyredejavu-math.otf"}},
    {"url": "https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz",
     "sha256": "7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0", "kind": "tar",
     "members": {**{f"liberation-fonts-ttf-2.1.5/LiberationSerif-{s}.ttf": f"liberation/LiberationSerif-{s}.ttf"
                    for s in ("Regular", "Bold", "Italic", "BoldItalic")},
                 "liberation-fonts-ttf-2.1.5/LICENSE": "liberation/LICENSE"}},
    {"url": "https://storage.googleapis.com/chromeos-localmirror/distfiles/croscorefonts-1.23.0.tar.gz",
     "sha256": "b469b5457b093a9d8878ef6ff6868f54e258441b88983b1866f64c8995584b4c", "kind": "tar",
     "members": {f"croscorefonts-1.23.0/Tinos-{s}.ttf": f"croscore/Tinos-{s}.ttf" for s in ("Regular", "Bold", "Italic", "BoldItalic")}},
    {"url": "https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.tar.bz2",
     "sha256": "fa9ca4d13871dd122f61258a80d01751d603b4d3ee14095d65453b4e846e17d7", "kind": "tar",
     "members": {**{f"dejavu-fonts-ttf-2.37/ttf/{n}": f"dejavu/{n}" for n in (
         "DejaVuSans-Bold.ttf", "DejaVuSerif.ttf", "DejaVuSerif-Bold.ttf", "DejaVuSerif-Italic.ttf", "DejaVuSerif-BoldItalic.ttf")},
                 "dejavu-fonts-ttf-2.37/LICENSE": "dejavu/LICENSE"}},
    {"url": DEB + "f/fonts-tlwg/fonts-tlwg-laksaman-ttf_0.7.4-2_all.deb",
     "sha256": "6d2da38a8367b9f9f4bf7236f021968192582c1527252b53795de99625e968d0", "kind": "deb",
     "members": {"*/tlwg/Laksaman.ttf": "tlwg/Laksaman.ttf", "*/tlwg/Laksaman-Bold.ttf": "tlwg/Laksaman-Bold.ttf",
                 "*/tlwg/Laksaman-Italic.ttf": "tlwg/Laksaman-Italic.ttf", "*/tlwg/Laksaman-BoldItalic.ttf": "tlwg/Laksaman-BoldItalic.ttf",
                 "*/doc/fonts-tlwg-laksaman-ttf/copyright": "tlwg/copyright"}},
    {"url": DEB + "f/fonts-freefont/fonts-freefont-ttf_20211204+svn4273-6_all.deb",
     "sha256": "0f29201f446bfef05e3b69fb92b14230569117d1aa9e7fd578790e47c80e15be", "kind": "deb",
     "members": {**{f"*/freefont/{n}": f"freefont/{n}" for n in (
         "FreeSerif.ttf", "FreeSerifBold.ttf", "FreeSerifItalic.ttf", "FreeSerifBoldItalic.ttf")},
                 "*/doc/fonts-freefont-ttf/copyright": "freefont/copyright"}},
    {"url": DEB + "f/fonts-linuxlibertine/fonts-linuxlibertine_5.3.0-7_all.deb",
     "sha256": "ac92ca46168cde740554046cb79ab592eff82fba52f59cda9701e9ec8da9e768", "kind": "deb",
     "members": {**{f"*/linux-libertine/{n}": f"libertine/{n}" for n in (
         "LinLibertine_R.otf", "LinLibertine_RB.otf", "LinLibertine_RI.otf", "LinLibertine_RBI.otf")},
                 "*/doc/fonts-linuxlibertine/copyright": "libertine/copyright"}},
    {"url": "https://www.apache.org/licenses/LICENSE-2.0.txt",
     "sha256": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30", "kind": "file", "dest": "licenses/Apache-2.0.txt"},
    {"url": "https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt",
     "sha256": "edaef632cbb643e4e7a221717a6c441a4c1a7c918e6e4d56debc3d8739b233f6", "kind": "file", "dest": "licenses/GPL-2.0.txt"},
    {"url": "https://www.gnu.org/licenses/gpl-3.0.txt",
     "sha256": "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986", "kind": "file", "dest": "licenses/GPL-3.0.txt"},
]


# Sources of the catalog families (suiteleaf_catalog.json), skipping any already listed above.
_CATALOG = json.loads((Path(__file__).with_name("suiteleaf_catalog.json")).read_text())
_LISTED = {(x.get("dest"), x["url"]): x for x in SOURCES}
for _source in _CATALOG["sources"]:
    _known = _LISTED.get((_source.get("dest"), _source["url"]))
    if _known is None:
        SOURCES.append(_source)
    elif _source["kind"] != "file":
        # Another archive already listed above: extract the catalog's files from it too.
        _known["members"] = {**_known["members"], **_source["members"]}


def _download(url):
    request = urllib.request.Request(url, headers={"User-Agent": "SuiteLeaf font build"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def _deb_data(blob):
    """The data.tar member of a Debian package (an `ar` archive)."""
    pos = 8
    while pos < len(blob):
        name = blob[pos:pos + 16].decode().strip().rstrip("/")
        size = int(blob[pos + 48:pos + 58].decode().strip())
        start = pos + 60
        if name.startswith("data.tar"):
            return blob[start:start + size]
        pos = start + size + (size & 1)
    raise ValueError("no data.tar in package")


def _extract(blob, kind, members, root):
    if kind == "zip":
        archive = zipfile.ZipFile(io.BytesIO(blob))
        names = archive.namelist()
        read = archive.read
    else:
        archive = tarfile.open(fileobj=io.BytesIO(_deb_data(blob) if kind == "deb" else blob))
        names = [m.name for m in archive.getmembers() if m.isfile()]
        read = lambda n: archive.extractfile(n).read()
    for pattern, dest in members.items():
        match = next((n for n in names if fnmatch.fnmatch(n, pattern) or fnmatch.fnmatch(n, "./" + pattern)), None)
        if match is None:
            raise FileNotFoundError(f"{pattern} not found in download")
        out = root / dest
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(read(match))


def fetch(cache=DEFAULT_CACHE):
    """Make sure every source is in `cache`; return the cache path."""
    root = Path(cache)
    for source in SOURCES:
        outputs = [source["dest"]] if source["kind"] == "file" else list(source["members"].values())
        if all((root / o).exists() for o in outputs):
            continue
        blob = _download(source["url"])
        digest = hashlib.sha256(blob).hexdigest()
        if digest != source["sha256"]:
            raise RuntimeError(f"{source['url']} has SHA-256 {digest}, expected {source['sha256']}")
        if source["kind"] == "file":
            out = root / source["dest"]
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(blob)
        else:
            _extract(blob, source["kind"], source["members"], root)
    return root


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cache", default=os.environ.get("SUITELEAF_FONT_CACHE", DEFAULT_CACHE))
    print(fetch(parser.parse_args().cache))
