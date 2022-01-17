#include <algorithm>
#include <array>
#include <iostream>
#include <string_view>
#include <tuple>

template <size_t N>
struct FixedString {
    constexpr FixedString(const char(&str)[N]) { std::copy_n(str, N, data_.data());}
    constexpr FixedString(const std::string_view sv) { std::copy_n(sv.data(), N, data_.data());}

    template<size_t b, size_t e>
    constexpr auto subStr() const {
        return FixedString<e-b>(std::string_view(&data_.data()[b], e-b));
    }
    constexpr std::string_view get() const { return std::string_view(data_.data(), N); }
    constexpr bool operator==(const char* b) const {
        for(size_t i{}; i<N; ++i) { if (b[i] != data_.data()[i]) return false; }; return true;
    }
    std::array<char, N> data_;
    static constexpr size_t len{N};
};

template<FixedString def, char delim=' '>
struct CxParser {
    static constexpr std::string_view sv{def.get()};
    static constexpr size_t N{1+std::count_if(sv.begin(), sv.end(), [](const char c) {return c==delim;})};

    template<size_t N>
    static constexpr auto getArg() {
        return def.template subStr<getDelimIdx(N), getDelimIdx(N+1)-1>();
    }

    static constexpr size_t getDelimIdx(size_t N) {
        size_t count{};
        size_t idx = 1+std::find_if(sv.begin(), sv.end(), [&](const char c) { return N<=(count+=(c==delim)); }) - sv.begin();
        return (N>0) * idx;
    }
};

struct TupleFactory {
    template<FixedString funName> requires(funName == "hello")
    static constexpr auto makeFun() {
        return []() { std::cout << "hello function" << std::endl; };
    }

    template<FixedString funName> requires(funName == "world")
    static constexpr auto makeFun() {
        return []() { std::cout << "world function" << std::endl; };
    }

    template<FixedString funName>
    static constexpr auto makeFun() {
        return []() { std::cout << "unknown func" << std::endl; };
    }

    template<CxParser Args>
    static constexpr auto getTup() {
        return []<std::size_t... I> (std::index_sequence<I...>){
            return std::make_tuple(makeFun<Args.template getArg<I>()>()...);
        }(std::make_index_sequence<Args.N>{});
    }
};


int main() {
    const auto parser = CxParser<"hello world xx hello hello">();

    // get a tuple of lambdas as defined by the string
    auto tupFun = TupleFactory::getTup<parser>();
    [tupFun]<std::size_t... I> (std::index_sequence<I...>){
        (std::get<I>(tupFun)(),...);
    }(std::make_index_sequence<std::tuple_size_v<decltype(tupFun)>>());
}
