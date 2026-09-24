using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;

// 用法: mdump <assembly.dll> [typeNameContains...]
// 只读元数据，不做依赖解析（无需加载 Avalonia 等依赖）。
class Program
{
    static MetadataReader R = null!;

    static void Main(string[] args)
    {
        // 模式二：--attrs <dll> [typeFilter...]  列出类型的自定义特性（含构造参数里的字符串常量）
        if (args.Length >= 2 && args[0] == "--attrs")
        {
            DumpAttrs(args[1], args.Skip(2).ToArray());
            return;
        }

        var path = args[0];
        var filters = args.Skip(1).ToArray();
        using var fs = File.OpenRead(path);
        using var pe = new PEReader(fs);
        R = pe.GetMetadataReader();

        foreach (var th in R.TypeDefinitions)
        {
            var td = R.GetTypeDefinition(th);
            var ns = R.GetString(td.Namespace);
            var name = R.GetString(td.Name);
            var full = string.IsNullOrEmpty(ns) ? name : ns + "." + name;
            if (filters.Length > 0 && !filters.Any(f => full.Contains(f, StringComparison.OrdinalIgnoreCase)))
                continue;

            bool isPublic = td.Attributes.HasFlag(TypeAttributes.Public);
            bool isIface = td.Attributes.HasFlag(TypeAttributes.Interface);
            bool isEnum = td.BaseType.IsNil ? false : TypeName(td.BaseType) == "System.Enum";
            Console.WriteLine($"=== {(isPublic ? "public" : "internal")} {(isEnum ? "enum" : (isIface ? "interface" : "type"))} {full}"
                + (td.BaseType.IsNil ? "" : " : " + TypeName(td.BaseType)));
            foreach (var ih in td.GetInterfaceImplementations())
                Console.WriteLine("      implements " + TypeName(R.GetInterfaceImplementation(ih).Interface));
            foreach (var fh in td.GetFields())
            {
                var f = R.GetFieldDefinition(fh);
                if (R.GetString(f.Name) == "value__") continue;
                Console.WriteLine($"    [field] {R.GetString(f.Name)} : {f.DecodeSignature(new Sigs(), null)}");
            }
            foreach (var ph in td.GetProperties())
            {
                var p = R.GetPropertyDefinition(ph);
                Console.WriteLine($"    [prop ] {p.DecodeSignature(new Sigs(), null)} {R.GetString(p.Name)}");
            }
            foreach (var mh in td.GetMethods())
            {
                var m = R.GetMethodDefinition(mh);
                var sig = m.DecodeSignature(new Sigs(), null);
                var methName = R.GetString(m.Name);
                if (methName == ".ctor")
                {
                    Console.WriteLine($"    [ctor ] ({string.Join(", ", sig.ParameterTypes)})");
                    continue;
                }
                var acc = m.Attributes.HasFlag(MethodAttributes.Public) ? "public" : "nonpub";
                var stat = m.Attributes.HasFlag(MethodAttributes.Static) ? " static" : "";
                var gpCount = m.GetGenericParameters().Count;
                var gp = gpCount > 0 ? "<" + string.Join(",", Enumerable.Range(0, gpCount).Select(i => "T" + i)) + ">" : "";
                Console.WriteLine($"    [meth ] {acc}{stat} {sig.ReturnType} {methName}{gp}({string.Join(", ", sig.ParameterTypes)})");
            }
            Console.WriteLine();
        }
    }

    /// <summary>列出类型上的自定义特性及构造参数中的字符串常量。</summary>
    static void DumpAttrs(string path, string[] filters)
    {
        using var fs = File.OpenRead(path);
        using var pe = new PEReader(fs);
        R = pe.GetMetadataReader();
        foreach (var th in R.TypeDefinitions)
        {
            var td = R.GetTypeDefinition(th);
            var ns = R.GetString(td.Namespace);
            var name = R.GetString(td.Name);
            var full = string.IsNullOrEmpty(ns) ? name : ns + "." + name;
            if (filters.Length > 0 && !filters.Any(f => full.Contains(f, StringComparison.OrdinalIgnoreCase)))
                continue;
            var found = new List<string>();
            foreach (var ah in td.GetCustomAttributes())
            {
                var ca = R.GetCustomAttribute(ah);
                var ctor = AttrCtorName(ca);
                // 取「所属类型名」而不是方法名：ctor 形如 "Ns.Type::.ctor"，
                // 之前误把 :: 之后当类名，导致所有特性都被过滤掉。
                var typePart = ctor.Contains("::") ? ctor.Substring(0, ctor.IndexOf("::")) : ctor;
                var shortName = typePart.Contains('.') ? typePart.Substring(typePart.LastIndexOf('.') + 1) : typePart;
                if (!shortName.Contains("Info") && !shortName.Contains("Component")) continue;
                found.Add(ctor + "(" + ScanStrings(ca.Value) + ")");
            }
            if (found.Count > 0)
                Console.WriteLine(full + "\n    " + string.Join("\n    ", found));
        }
    }

    static string AttrCtorName(CustomAttribute ca)
    {
        if (ca.Constructor.Kind == HandleKind.MemberReference)
        {
            var mr = R.GetMemberReference((MemberReferenceHandle)ca.Constructor);
            return TypeName(mr.Parent) + "::" + R.GetString(mr.Name);
        }
        if (ca.Constructor.Kind == HandleKind.MethodDefinition)
            return R.GetString(R.GetMethodDefinition((MethodDefinitionHandle)ca.Constructor).Name);
        return "?";
    }

    /// <summary>从特性 blob 里粗暴抓取 UTF8 字符串常量（0x0E = ELEMENT_TYPE_STRING 前缀）。</summary>
    static string ScanStrings(BlobHandle value)
    {
        try
        {
            var blob = R.GetBlobReader(value);
            var res = new List<string>();
            while (blob.RemainingBytes > 0)
            {
                var b = blob.ReadByte();
                if (b != 0x0E) continue;
                var len = blob.ReadCompressedInteger();
                if (len <= 0 || len > blob.RemainingBytes) continue;
                var bytes = blob.ReadBytes(len);
                res.Add("\"" + System.Text.Encoding.UTF8.GetString(bytes) + "\"");
            }
            return string.Join(", ", res);
        }
        catch (Exception ex) { return "<" + ex.GetType().Name + ">"; }
    }

    static string TypeName(EntityHandle h)
    {
        if (h.IsNil) return "<nil>";
        switch (h.Kind)
        {
            case HandleKind.TypeDefinition:
                {
                    var td = R.GetTypeDefinition((TypeDefinitionHandle)h);
                    var ns = R.GetString(td.Namespace);
                    return (string.IsNullOrEmpty(ns) ? "" : ns + ".") + R.GetString(td.Name);
                }
            case HandleKind.TypeReference:
                {
                    var tr = R.GetTypeReference((TypeReferenceHandle)h);
                    var ns = R.GetString(tr.Namespace);
                    return (string.IsNullOrEmpty(ns) ? "" : ns + ".") + R.GetString(tr.Name);
                }
            case HandleKind.TypeSpecification:
                return R.GetTypeSpecification((TypeSpecificationHandle)h).DecodeSignature(new Sigs(), null);
            default:
                return h.Kind.ToString();
        }
    }

    class Sigs : ISignatureTypeProvider<string, object?>
    {
        public string GetArrayType(string e, ArrayShape s) => e + "[]";
        public string GetByReferenceType(string e) => "ref " + e;
        public string GetFunctionPointerType(MethodSignature<string> s) => "fnptr";
        public string GetGenericInstantiation(string g, System.Collections.Immutable.ImmutableArray<string> a) => g + "<" + string.Join(",", a) + ">";
        public string GetGenericMethodParameter(object? c, int i) => "!!" + i;
        public string GetGenericTypeParameter(object? c, int i) => "!" + i;
        public string GetModifiedType(string m, string u, bool r) => u;
        public string GetPinnedType(string e) => e;
        public string GetPointerType(string e) => e + "*";
        public string GetPrimitiveType(PrimitiveTypeCode c) => c.ToString();
        public string GetSZArrayType(string e) => e + "[]";
        public string GetTypeFromDefinition(MetadataReader r, TypeDefinitionHandle h, byte rk) => TypeName(h);
        public string GetTypeFromReference(MetadataReader r, TypeReferenceHandle h, byte rk) => TypeName(h);
        public string GetTypeFromSpecification(MetadataReader r, object? c, TypeSpecificationHandle h, byte rk) => TypeName(h);
    }
}
